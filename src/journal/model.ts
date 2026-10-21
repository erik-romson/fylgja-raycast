/** The Journal view model: sections, rows, Recap and Where text, actions and How text. Plain TypeScript (R2). */
import { dayLabel, escapeMarkdown, formatAgo, oneLine, truncate } from "../format";
import type { JournalHow, JournalItem, JournalRecap, JournalThread, JournalWhere } from "../fylgja/journal-types";
import type { ShortcutDescriptor } from "../item-actions";

const TITLE_MAX = 100;
const SUBTITLE_MAX = 80;
const NAV_TITLE_MAX = 60;

export interface JournalRow {
  id: string;
  kind: "item" | "headline" | "where" | "recap";
  title: string;
  subtitle?: string;
  /** Items carry a pin marker when pinned. */
  pinned: boolean;
  /** Set for `kind: "item"`. */
  item?: JournalItem;
  /** Set for `kind: "headline"`: the whole headline, which the list cuts. */
  text?: string;
  /** Set for `kind: "recap"`. */
  recap?: JournalRecap;
  /** Set for `kind: "where"`: the whole detail pane. */
  detail?: string;
}

export interface JournalSection {
  id: string;
  title: string;
  rows: JournalRow[];
}

export type JournalView =
  | { kind: "rows"; sections: JournalSection[] }
  | { kind: "where-only"; row: JournalRow }
  | { kind: "empty"; title: string; description: string };

export type JournalActionId =
  "how" | "mark-done" | "open-source" | "make-todo" | "todo-exists" | "pin" | "drop" | "refresh";

export interface JournalActionDescriptor {
  id: JournalActionId;
  title: string;
  shortcut?: ShortcutDescriptor;
  destructive?: boolean;
}

/** The thread's last-attempt banner, when it has an `error_kind`. */
export function banner(thread: JournalThread): string | undefined {
  const kind = oneLine(thread.error_kind ?? "");
  return kind === "" ? undefined : `Last attempt failed: ${kind}`;
}

export function whereText(where: JournalWhere | undefined): string {
  const text = oneLine(where?.text ?? "");
  switch (where?.state) {
    case "fresh":
      return text !== "" ? text : "Nothing yet";
    case "pending":
      return text !== "" ? `${text} (updating…)` : "Writing an entry";
    case "failed":
      return text !== "" ? `${text} (last attempt failed)` : "Last attempt failed";
    case "missing":
      return "Nothing yet";
    default:
      return text !== "" ? text : "Nothing yet";
  }
}

function itemRow(item: JournalItem, prefix = ""): JournalRow {
  return {
    id: `item:${item.id}`,
    kind: "item",
    title: truncate(oneLine(`${prefix}${item.text}`), TITLE_MAX),
    pinned: item.pinned === true,
    item,
  };
}

function capitalise(s: string): string {
  const [first = "", ...rest] = Array.from(s);
  return first.toUpperCase() + rest.join("");
}

/** The Recap row: the session's own summary of the work, with its age as the subtitle. */
function recapRow(recap: JournalRecap, now: Date | number): JournalRow {
  return {
    id: "recap",
    kind: "recap",
    title: truncate(oneLine(recap.text), TITLE_MAX),
    subtitle: formatAgo(recap.at, now),
    pinned: false,
    recap,
  };
}

export function journalSections(thread: JournalThread, now: Date | number = Date.now()): JournalSection[] {
  const sections: JournalSection[] = [];
  if (thread.recap && oneLine(thread.recap.text) !== "") {
    sections.push({ id: "recap", title: "Recap", rows: [recapRow(thread.recap, now)] });
  }
  const open: [string, string, JournalItem[] | undefined][] = [
    ["next", "Do next", thread.open?.next],
    ["remember", "Keep in mind", thread.open?.remember],
    ["blocked", "Blocked", thread.open?.blocked],
  ];
  for (const [id, title, items] of open) {
    if (items && items.length > 0) sections.push({ id, title, rows: items.map((i) => itemRow(i)) });
  }
  for (const day of thread.done_recent ?? []) {
    const rows: JournalRow[] = [];
    (day.headlines ?? []).forEach((headline, index) => {
      rows.push({
        id: `headline:${day.day}:${index}`,
        kind: "headline",
        title: truncate(oneLine(headline), TITLE_MAX),
        pinned: false,
        text: oneLine(headline),
      });
    });
    for (const item of day.items ?? []) rows.push(itemRow(item, "Done: "));
    if (rows.length === 0) continue;
    sections.push({
      id: `done:${day.day}`,
      title: day.relative ? capitalise(oneLine(day.relative)) : dayLabel(day.day, now),
      rows,
    });
  }
  return sections;
}

/** The detail pane's heading: the checkout the journal belongs to. */
function checkoutHeading(thread: JournalThread): string {
  return `## ${escapeMarkdown(navigationTitle(thread))}`;
}

/**
 * The Where block of the detail pane: escaped text and the thread banner. When the banner names the failure, the text
 * leaves out its own "(last attempt failed)".
 */
function whereBlock(thread: JournalThread): string {
  const bannerText = banner(thread);
  const text = oneLine(thread.where?.text ?? "");
  const where = bannerText && thread.where?.state === "failed" ? text : whereText(thread.where);
  return [where, bannerText]
    .filter((p): p is string => p !== undefined && p !== "")
    .map(escapeMarkdown)
    .join("\n\n");
}

export function journalView(thread: JournalThread, now: Date | number = Date.now()): JournalView {
  const sections = journalSections(thread, now);
  if (sections.length > 0) return { kind: "rows", sections };
  const text = oneLine(thread.where?.text ?? "");
  if (text !== "") {
    return {
      kind: "where-only",
      row: {
        id: "where",
        kind: "where",
        title: "Where you are",
        subtitle: truncate(text, SUBTITLE_MAX),
        pinned: false,
        detail: `${checkoutHeading(thread)}\n\n${whereBlock(thread)}`,
      },
    };
  }
  return {
    kind: "empty",
    title: `No journal entries yet for ${checkoutName(thread)}`,
    description: whereText(thread.where),
  };
}

/**
 * The detail pane of a row of the `rows` view: the checkout, the item's or headline's whole text (and an item's source
 * and How state), then Where you are, which is the same for every row.
 */
export function rowDetail(thread: JournalThread, row: JournalRow): string {
  const parts = [checkoutHeading(thread)];
  if (row.text) parts.push(escapeMarkdown(row.text), "---");
  if (row.recap) {
    const age = row.subtitle ? ` · ${escapeMarkdown(row.subtitle)}` : "";
    parts.push(`**Recap**${age}`, escapeMarkdown(oneLine(row.recap.text)), "---");
  }
  const item = row.item;
  if (item) {
    const source = item.source;
    const lines = [`**Source:** ${escapeMarkdown(oneLine(`${source.kind}: ${source.label}`))}`];
    if (source.kind === "file" && source.path) lines.push(`**Path:** ${escapeMarkdown(oneLine(source.path))}`);
    lines.push(`**How:** ${item.has_how ? "a checklist exists" : "no checklist yet"}`);
    parts.push(escapeMarkdown(item.text.trim()), lines.join("\n\n"), "---");
  }
  parts.push("**Where you are**", whereBlock(thread));
  return parts.join("\n\n");
}

function hasOpenSource(item: JournalItem): boolean {
  const source = item.source;
  if (!source) return false;
  if (source.kind === "session") return true;
  return source.kind === "file" && typeof source.path === "string" && source.path !== "";
}

export function journalActions(item: JournalItem): JournalActionDescriptor[] {
  const actions: JournalActionDescriptor[] = [];
  const openSource: JournalActionDescriptor = {
    id: "open-source",
    title: "Open Source",
    shortcut: { common: "Open" },
  };
  const refresh: JournalActionDescriptor = { id: "refresh", title: "Refresh", shortcut: { common: "Refresh" } };
  if (item.status !== "open") {
    if (hasOpenSource(item)) actions.push(openSource);
    actions.push(refresh);
    return actions;
  }
  actions.push({ id: "how", title: "How Do I Do This?" });
  actions.push({ id: "mark-done", title: "Mark as Done" });
  if (hasOpenSource(item)) actions.push(openSource);
  actions.push(
    item.todo_id
      ? { id: "todo-exists", title: "Todo Exists", shortcut: { modifiers: ["cmd"], key: "t" } }
      : { id: "make-todo", title: "Make a Todo", shortcut: { modifiers: ["cmd"], key: "t" } },
  );
  actions.push({ id: "pin", title: item.pinned ? "Unpin" : "Pin", shortcut: { common: "Pin" } });
  actions.push({ id: "drop", title: "Drop", shortcut: { common: "Remove" }, destructive: true });
  actions.push(refresh);
  return actions;
}

/** Actions of a row that has no item (a headline, the Where row). */
export function refreshOnlyActions(): JournalActionDescriptor[] {
  return [{ id: "refresh", title: "Refresh", shortcut: { common: "Refresh" } }];
}

const LIST_MARKER = /^\s*(?:\d{1,9}[.)]|[-*+])\s+/;

function stepsList(steps: string[] | undefined): string {
  return (steps ?? [])
    .map((step, index) => `${index + 1}. ${escapeMarkdown(oneLine(step.replace(LIST_MARKER, "")))}`)
    .join("\n");
}

export function howMarkdown(how: JournalHow): string {
  const list = stepsList(how.steps);
  const withSteps = (head: string) => (list === "" ? head : `${head}\n\n${list}`);
  switch (how.state) {
    case "fresh":
      return list === "" ? "No checklist yet" : list;
    case "pending":
      return "Pending — press ⌘R to read it again";
    case "failed": {
      const kind = oneLine(how.error_kind ?? "");
      return withSteps(kind === "" ? "Failed" : `Failed: ${escapeMarkdown(kind)}`);
    }
    case "stale":
      return withSteps("Out of date — press ⌘R to read it again");
    case "missing":
      return "No checklist yet";
    default:
      return withSteps(`State: ${escapeMarkdown(oneLine(String(how.state).replace(/_/g, " ")))}`);
  }
}

/** The checkout's last two path components (`fylgja-raycast/main`), as the Navigator names folders; else its name. */
export function checkoutName(thread: JournalThread): string {
  return oneLine(thread.folder || thread.name);
}

export function navigationTitle(thread: JournalThread): string {
  return truncate(`${checkoutName(thread)} · ${oneLine(thread.branch)}`, NAV_TITLE_MAX);
}
