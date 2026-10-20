/** The Navigator list's row model, view state and titles. Plain TypeScript (R2). The daemon orders and counts (R1). */
import { FylgjaError, messages } from "./fylgja/errors";
import type { AwayChange, GoTarget, Items, NavItem } from "./fylgja/types";
import { dayLabel, formatAgo, formatDuration, oneLine, truncate } from "./format";

export type Tone = "urgent" | "warning" | "neutral" | "subtle";

/** Where a state comes from; `src/ui/` shows it as the tag's icon. */
export type TagSource = "agent" | "run" | "ci" | "review" | "pr" | "git" | "todo" | "unread";

export interface AccessoryModel {
  text: string;
  tone: Tone;
  tooltip?: string;
  source?: TagSource;
}

export interface RowModel {
  id: string;
  title: string;
  subtitle: string;
  accessories: AccessoryModel[];
}

export interface AwayRowModel extends RowModel {
  /** The item the change belongs to. */
  item: string;
  go?: GoTarget;
}

const SUBTITLE_MAX = 100;
const TAG_MAX = 40;

/** Waiting kinds with their urgency (higher is more urgent). */
const WAITING_URGENCY: Record<string, number> = {
  permission: 4,
  input: 4,
  turn_done: 3,
  run_finished: 3,
  build_failed: 2,
  review_requested: 2,
  unread: 1,
};
const TOP_URGENCY = 4;

/** The text and source of each state the client knows; any other state shows as its words. */
const STATES: Record<string, { text: string; source: TagSource }> = {
  permission: { text: "needs approval", source: "agent" },
  input: { text: "needs answer", source: "agent" },
  turn_done: { text: "done", source: "agent" },
  run_finished: { text: "run finished", source: "run" },
  build_failed: { text: "build failed", source: "ci" },
  review_requested: { text: "review requested", source: "review" },
  unread: { text: "unread", source: "unread" },
  dirty: { text: "dirty", source: "git" },
  pr_open: { text: "PR open", source: "pr" },
  todo_next: { text: "todo next", source: "todo" },
};

function isWaiting(kind: string): boolean {
  return Object.hasOwn(WAITING_URGENCY, kind);
}

function stateText(kind: string): string {
  return Object.hasOwn(STATES, kind) ? STATES[kind]!.text : kind.replace(/_/g, " ");
}

function tag(text: string, tone: Tone = "neutral", tooltip?: string): AccessoryModel {
  const accessory: AccessoryModel = { text: truncate(oneLine(text), TAG_MAX), tone };
  if (tooltip !== undefined) accessory.tooltip = truncate(oneLine(tooltip), 200);
  return accessory;
}

function stateTag(kind: string, tone: Tone, tooltip?: string): AccessoryModel {
  const accessory = tag(stateText(kind), tone, tooltip);
  if (Object.hasOwn(STATES, kind)) accessory.source = STATES[kind]!.source;
  return accessory;
}

function waitingTone(kind: string): Tone {
  return WAITING_URGENCY[kind] === TOP_URGENCY ? "urgent" : "warning";
}

function sameTarget(a: GoTarget | undefined, b: GoTarget | undefined): boolean {
  return a !== undefined && b !== undefined && a.kind === b.kind && a.ref === b.ref;
}

export interface RowOptions {
  pendingSummary: ReadonlySet<string>;
  now: Date | number;
}

export function toRow(item: NavItem, options: RowOptions): RowModel {
  const places = item.places ?? [];
  const state = item.state ?? [];
  const tickets = item.tickets ?? [];
  const goPlace = item.go ? places.find((p) => sameTarget(p, item.go)) : undefined;

  const subtitleSource = item.summary !== "" ? item.summary : (goPlace?.title ?? "");
  const subtitle = truncate(oneLine(subtitleSource ?? ""), SUBTITLE_MAX);

  const accessories: AccessoryModel[] = [];
  if (options.pendingSummary.has(item.id)) accessories.push(tag("summarizing…", "subtle", "Summary in progress"));

  if (tickets.length > 0) {
    accessories.push(
      tag(
        tickets.length > 1 ? `${tickets[0]} +${tickets.length - 1}` : String(tickets[0]),
        "neutral",
        tickets.join(", "),
      ),
    );
  }

  const waiting = state.filter(isWaiting);
  let topWaiting: string | undefined;
  for (const kind of waiting) {
    if (topWaiting === undefined || WAITING_URGENCY[kind]! > WAITING_URGENCY[topWaiting]!) topWaiting = kind;
  }
  if (topWaiting !== undefined) {
    accessories.push(stateTag(topWaiting, waitingTone(topWaiting), `Waiting: ${waiting.map(stateText).join(", ")}`));
  }

  const seen = new Set<string>();
  for (const kind of state) {
    if (isWaiting(kind) || seen.has(kind)) continue;
    seen.add(kind);
    accessories.push(stateTag(kind, "neutral"));
  }

  if (goPlace?.workspace) accessories.push(tag(`ws ${goPlace.workspace}`, "subtle"));

  if (item.seconds_today >= 1) {
    accessories.push(tag(`${formatDuration(item.seconds_today)} today`, "subtle"));
  } else {
    const ago = formatAgo(item.last_focus_at, options.now);
    if (ago !== "") accessories.push(tag(ago, "subtle"));
  }

  if (!item.go) accessories.push(tag("nothing open", "subtle"));

  return { id: item.id, title: oneLine(item.name), subtitle, accessories };
}

export function awayRows(whileAway: AwayChange[] | undefined, now: Date | number): AwayRowModel[] {
  return (whileAway ?? []).map((change, index) => {
    const accessories: AccessoryModel[] = [stateTag(change.kind, waitingTone(change.kind))];
    const ago = formatAgo(change.since, now);
    if (ago !== "") accessories.push(tag(ago, "subtle"));
    const row: AwayRowModel = {
      id: `away:${change.item}:${change.kind}:${index}`,
      title: oneLine(change.name),
      subtitle: truncate(oneLine(change.reason), SUBTITLE_MAX),
      accessories,
      item: change.item,
    };
    if (change.go) row.go = change.go;
    return row;
  });
}

export type ViewStateKind =
  "loading" | "searching" | "error" | "empty-no-match" | "empty-nothing-recorded" | "empty-nothing-open" | "list";

export interface ViewState {
  kind: ViewStateKind;
  /** The empty view's title. */
  title?: string;
  /** Turning the `onlyOpen` preference off could show something. */
  offerPreferences?: boolean;
}

export interface ViewStateInput {
  loading: boolean;
  data: Items | undefined;
  error: FylgjaError | undefined;
  /** The search text. Whitespace-only counts as empty. */
  q: string;
  onlyOpen: boolean;
}

export function viewState({ data, error, q, onlyOpen }: ViewStateInput): ViewState {
  const query = q.trim();
  if (error && error.kind !== "aborted") return { kind: "error", title: error.message };
  if (!data) return query === "" ? { kind: "loading" } : { kind: "searching", title: "Searching…" };
  if (data.shown > 0) return { kind: "list" };

  const offerPreferences = onlyOpen && data.total > 0;
  if (query !== "") {
    const title = onlyOpen ? "No open items match" : "No items match";
    return offerPreferences ? { kind: "empty-no-match", title, offerPreferences } : { kind: "empty-no-match", title };
  }
  if (data.total > 0 && onlyOpen) {
    return { kind: "empty-nothing-open", title: "Nothing is open", offerPreferences };
  }
  return { kind: "empty-nothing-recorded", title: "Nothing recorded yet" };
}

export function navigationTitle(answer: Items, { onlyOpen }: { onlyOpen: boolean }): string {
  let title = `${answer.shown} of ${answer.total} · ${answer.ranker}`;
  if (answer.ranker_fallback) title += " · fallback";
  if (onlyOpen) title += " · open only";
  return title;
}

export function showAwaySection(answer: Items, q: string): boolean {
  return (answer.while_away ?? []).length > 0 && q.trim() === "";
}

export type SectionKey = "away" | "items";

/** The ordered section keys the list shows. */
export function sections(answer: Items, q: string): SectionKey[] {
  return showAwaySection(answer, q) ? ["away", "items"] : ["items"];
}

export interface DaySection {
  /** The formatted day label. */
  title: string;
  items: NavItem[];
}

/**
 * The daemon's day groups as sections, in the order sent. `days[]` must hold each of `items[]` exactly once; a
 * mismatch is a `contract` error and is never repaired (R1).
 */
export function daySections(answer: Items, now: Date | number): { sections: DaySection[] } | { error: FylgjaError } {
  const byId = new Map<string, NavItem>();
  for (const item of answer.items ?? []) byId.set(item.id, item);
  const fail = (what: string) => ({ error: new FylgjaError("contract", messages.contract(what)) });

  const seenDays = new Set<string>();
  const seenIds = new Set<string>();
  const result: DaySection[] = [];
  for (const group of answer.days ?? []) {
    if (seenDays.has(group.day)) return fail(`day ${group.day} twice`);
    seenDays.add(group.day);
    const ids = group.items ?? [];
    if (ids.length === 0) return fail(`empty day ${group.day}`);
    const items: NavItem[] = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) return fail(`unknown item in day ${group.day}`);
      if (seenIds.has(id)) return fail("item listed twice");
      seenIds.add(id);
      items.push(item);
    }
    result.push({ title: dayLabel(group.day, now), items });
  }
  for (const id of byId.keys()) if (!seenIds.has(id)) return fail("item in no day");
  return { sections: result };
}
