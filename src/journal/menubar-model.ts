/** The menu bar of the Journal command: title, tooltip and menu items as data. Plain TypeScript (R2). */

import { firstSentence, oneLine, truncate } from "../format";
import { FylgjaError } from "../fylgja/errors";
import type { FocusedJournal, JournalThread } from "../fylgja/journal-types";
import { checkoutName } from "./model";

export const MENUBAR_TITLE_MAX = 40;
export const MENUBAR_TIMEOUT_MS = 4_000;
const WHERE_MAX = 200;
const ITEM_MAX = 80;
const TOOLTIP_MAX = 600;

export type MenubarItem =
  | { kind: "info"; title: string; disabled?: true }
  | { kind: "open-journal"; title: string }
  | { kind: "refresh"; title: string };

export interface MenubarModel {
  /** Absent when the menu bar shows only the icon. Never a previous title. */
  title?: string;
  tooltip: string;
  items: MenubarItem[];
}

function line(s: string, max: number): string {
  return truncate(oneLine(s), max);
}

function failure(kind: string | undefined): string {
  return kind ? `: ${oneLine(kind)}` : "";
}

function threadModel(thread: JournalThread): MenubarModel {
  const where = thread.where;
  const text = oneLine(where?.text ?? "");
  const title = firstSentence(text, MENUBAR_TITLE_MAX);

  let tooltip: string;
  if (text !== "") {
    if (where.state === "pending") tooltip = `${text} (updating…)`;
    else if (where.state === "failed") tooltip = `${text} (last attempt failed${failure(thread.error_kind)})`;
    else tooltip = text;
  } else if (where?.state === "pending") tooltip = "Writing an entry";
  else if (where?.state === "failed") tooltip = `Last attempt failed${failure(thread.error_kind)}`;
  else tooltip = "No entry yet";

  const items: MenubarItem[] = [{ kind: "info", title: line(`${checkoutName(thread)} · ${thread.branch}`, ITEM_MAX) }];
  if (text !== "") items.push({ kind: "info", title: line(text, WHERE_MAX) });
  for (const item of thread.open?.next ?? []) {
    if (item.shown === true) items.push({ kind: "info", title: line(item.text, ITEM_MAX) });
  }
  items.push({ kind: "open-journal", title: "Open Fylgja Journal" }, { kind: "refresh", title: "Refresh" });

  return { ...(title !== "" ? { title } : {}), tooltip: line(tooltip, TOOLTIP_MAX), items };
}

function messageModel(message: string): MenubarModel {
  const text = line(message, TOOLTIP_MAX);
  return { tooltip: text, items: [{ kind: "info", title: line(message, WHERE_MAX), disabled: true }] };
}

/** A pure function of the latest result: no title survives from an earlier one, and nothing here toasts (R7). */
export function menubarModel(result: FocusedJournal | Error): MenubarModel {
  if (result instanceof Error) {
    return messageModel(result instanceof FylgjaError ? result.message : "Fylgja could not be read");
  }
  switch (result.kind) {
    case "thread":
      return threadModel(result.thread);
    case "empty":
      return messageModel(result.detail);
    case "off":
      return messageModel("The journal is off in Fylgja");
  }
}
