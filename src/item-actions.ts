/** Which actions a Navigator item has, in order, with titles and shortcut descriptors (R10). Plain TypeScript (R2). */
import type { GoTarget, ItemPlace, NavItem } from "./fylgja/types";
import { oneLine, truncate } from "./format";

export type KeyModifier = "cmd" | "ctrl" | "opt" | "shift";

/** A shortcut as data; `src/ui/` maps it to a Raycast value. */
export type ShortcutDescriptor =
  { common: "Refresh" | "CopyPath" | "Copy" | "Open" | "Pin" | "Remove" } | { modifiers: KeyModifier[]; key: string };

/** Shortcuts Raycast keeps for itself (R10). */
export const RESERVED_SHORTCUTS: readonly ShortcutDescriptor[] = [
  { modifiers: ["cmd"], key: "k" },
  { modifiers: ["cmd"], key: "w" },
  { modifiers: ["cmd"], key: "," },
  { modifiers: ["cmd"], key: "p" },
  { modifiers: ["cmd"], key: "q" },
  { modifiers: ["cmd"], key: "a" },
  { modifiers: ["cmd"], key: "escape" },
  { modifiers: [], key: "escape" },
  { modifiers: ["cmd"], key: "return" },
  { modifiers: [], key: "return" },
  { modifiers: ["cmd", "shift"], key: "/" },
  { modifiers: [], key: "delete" },
  { modifiers: ["cmd"], key: "delete" },
  { modifiers: ["cmd", "shift"], key: "delete" },
  { modifiers: ["ctrl"], key: "delete" },
  { modifiers: ["opt"], key: "delete" },
  { modifiers: ["cmd"], key: "backspace" },
];

export type ItemActionKind =
  "go" | "toggle-details" | "summarize" | "go-role" | "focus-place" | "copy-path" | "copy-ticket" | "refresh";

export interface PlaceEntry {
  /** Unique within the submenu. */
  id: string;
  title: string;
  target: GoTarget;
}

export interface TicketEntry {
  id: string;
  title: string;
  text: string;
}

export interface ItemActionDescriptor {
  id: string;
  kind: ItemActionKind;
  title: string;
  shortcut?: ShortcutDescriptor;
  /** For `go` and `go-role`. */
  target?: GoTarget;
  /** The text a Copy action copies (a single ticket, the path). */
  copy?: string;
  /** For the Focus Place submenu. */
  places?: PlaceEntry[];
  /** For the Copy Ticket submenu (more than one ticket). */
  tickets?: TicketEntry[];
}

const ENTRY_TITLE_MAX = 80;

export function placeEntryTitle(place: ItemPlace): string {
  const title = oneLine(place.title ?? "");
  const ws = place.workspace ? ` (ws ${oneLine(place.workspace)})` : "";
  return truncate(`${oneLine(place.label)}${title !== "" ? ` — ${title}` : ""}${ws}`, ENTRY_TITLE_MAX);
}

/** `summariesEnabled` is the answer's `summaries_enabled`; Summarize exists only when it is true. */
export function itemActions(item: NavItem, summariesEnabled = false): ItemActionDescriptor[] {
  const actions: ItemActionDescriptor[] = [];

  if (item.go) actions.push({ id: "go", kind: "go", title: "Go", target: item.go });
  actions.push({
    id: "toggle-details",
    kind: "toggle-details",
    title: "Toggle Details",
    shortcut: { modifiers: ["cmd"], key: "i" },
  });

  if (summariesEnabled) {
    actions.push({
      id: "summarize",
      kind: "summarize",
      title: "Summarize",
      shortcut: { modifiers: ["cmd"], key: "s" },
    });
  }

  const roles: [GoTarget | undefined, string, string, string][] = [
    [item.go_ide, "go-ide", "Go to IDE", "1"],
    [item.go_agent, "go-agent", "Go to Agent", "2"],
    [item.go_terminal, "go-terminal", "Go to Terminal", "3"],
  ];
  for (const [target, id, title, key] of roles) {
    if (target) actions.push({ id, kind: "go-role", title, target, shortcut: { modifiers: ["cmd"], key } });
  }

  const open = (item.places ?? []).filter((p) => p.open);
  if (open.length > 0) {
    actions.push({
      id: "focus-place",
      kind: "focus-place",
      title: "Focus Place",
      shortcut: { modifiers: ["cmd"], key: "g" },
      places: open.map((p, i) => ({
        id: `${i}:${p.kind}:${p.ref}`,
        title: placeEntryTitle(p),
        target: { kind: p.kind, ref: p.ref },
      })),
    });
  }

  if (item.path) {
    actions.push({
      id: "copy-path",
      kind: "copy-path",
      title: "Copy Path",
      shortcut: { common: "CopyPath" },
      copy: item.path,
    });
  }

  const tickets = item.tickets ?? [];
  if (tickets.length === 1) {
    actions.push({
      id: "copy-ticket",
      kind: "copy-ticket",
      title: "Copy Ticket",
      shortcut: { common: "Copy" },
      copy: tickets[0]!,
    });
  } else if (tickets.length > 1) {
    actions.push({
      id: "copy-ticket",
      kind: "copy-ticket",
      title: "Copy Ticket",
      shortcut: { common: "Copy" },
      tickets: tickets.map((t, i) => ({ id: `${i}:${t}`, title: truncate(oneLine(t), ENTRY_TITLE_MAX), text: t })),
    });
  }

  actions.push({ id: "refresh", kind: "refresh", title: "Refresh", shortcut: { common: "Refresh" } });
  return actions;
}
