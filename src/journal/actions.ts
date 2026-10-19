/** The Journal action executor and the Open Source runner, with their effects injected. Plain TypeScript (R2). */
import { FylgjaError, messages } from "../fylgja/errors";
import type { ItemPatch, JournalItem } from "../fylgja/journal-types";
import { oneLine, truncate } from "../format";
import { journalActions } from "./model";
import type { OpenPlan } from "./open-source";

export type RunnableAction = "mark-done" | "pin" | "drop" | "undo" | "make-todo" | "todo-exists" | "refresh";

export interface ToastAction {
  title: string;
  run: () => unknown;
}

export interface ActionDeps {
  patchItem: (id: string, patch: ItemPatch) => Promise<unknown>;
  makeTodo: (id: string) => Promise<{ created: boolean }>;
  refetch: () => Promise<unknown> | void;
  showToast: (toast: { title: string; action?: ToastAction }) => Promise<unknown> | void;
  showFailureToast: (message: string, action?: ToastAction) => Promise<unknown> | void;
}

const MESSAGE_MAX = 200;

function line(message: string): string {
  return truncate(oneLine(message), MESSAGE_MAX);
}

function failureOf(err: unknown): { aborted: boolean; message: string } {
  if (err instanceof FylgjaError) return { aborted: err.kind === "aborted", message: err.message };
  return { aborted: false, message: "Fylgja could not do that" };
}

export async function runJournalAction(action: RunnableAction, item: JournalItem, deps: ActionDeps): Promise<void> {
  if (action !== "undo" && !journalActions(item).some((a) => a.id === action)) {
    await deps.showFailureToast(line(messages.bad_request(`${action} is not offered for this item`)));
    return;
  }
  try {
    switch (action) {
      case "mark-done":
        await deps.patchItem(item.id, { status: "done" });
        break;
      case "pin":
        await deps.patchItem(item.id, { pinned: !item.pinned });
        break;
      case "drop":
        await deps.patchItem(item.id, { status: "dropped" });
        await deps.showToast({
          title: "Dropped",
          action: { title: "Undo", run: () => runJournalAction("undo", item, deps) },
        });
        break;
      case "undo":
        await deps.patchItem(item.id, { status: "open" });
        break;
      case "make-todo":
      case "todo-exists": {
        const { created } = await deps.makeTodo(item.id);
        await deps.showToast({ title: created ? "Todo made" : "The todo already exists" });
        break;
      }
      case "refresh":
        break;
    }
    await deps.refetch();
  } catch (err) {
    const failure = failureOf(err);
    if (!failure.aborted) await deps.showFailureToast(line(failure.message));
  }
}

export interface OpenSourceDeps {
  /** Reads the secret; rejects with `no_secret` or `bad_secret`. */
  checkSecret: () => Promise<unknown>;
  focus: (target: { kind: "session"; ref: string }) => Promise<unknown>;
  closeMainWindow: () => Promise<unknown>;
  open: (target: string) => Promise<unknown>;
  showFailureToast: (message: string, action?: ToastAction) => Promise<unknown> | void;
  baseUrl: string;
}

let openInFlight = false;

/** R7's one exception: a session is focused while the window is open and the window closes only after success. */
export async function runOpenSource(plan: OpenPlan, deps: OpenSourceDeps): Promise<void> {
  if (openInFlight) return;
  openInFlight = true;
  try {
    if ("refuse" in plan) {
      await deps.showFailureToast(line(plan.refuse));
      return;
    }
    if ("open" in plan) {
      try {
        await deps.open(plan.open);
      } catch {
        await deps.showFailureToast("Could not open that file");
        return;
      }
      await closeQuietly(deps);
      return;
    }
    try {
      await deps.checkSecret();
      await deps.focus({ kind: "session", ref: plan.focus });
    } catch (err) {
      const failure = failureOf(err);
      if (failure.aborted) return;
      const page = err instanceof FylgjaError && (err.kind === "not_found" || err.kind === "conflict");
      await deps.showFailureToast(
        line(failure.message),
        page ? { title: "Open Fylgja Page", run: () => deps.open(`${deps.baseUrl}/`) } : undefined,
      );
      return;
    }
    await closeQuietly(deps);
  } finally {
    openInFlight = false;
  }
}

async function closeQuietly(deps: OpenSourceDeps): Promise<void> {
  try {
    await deps.closeMainWindow();
  } catch {
    // The window may already be closed.
  }
}
