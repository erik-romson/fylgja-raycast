/** The Go flow: focus an item's window or session, with its effects injected. Plain TypeScript (R2). */
import { FylgjaError } from "./fylgja/errors";
import type { GoTarget, NavItem } from "./fylgja/types";
import { oneLine, truncate } from "./format";

export interface GoDeps {
  /** Reads the secret; rejects with `no_secret` or `bad_secret`. */
  checkSecret: () => Promise<unknown>;
  closeMainWindow: () => Promise<unknown>;
  focus: (target: GoTarget) => Promise<unknown>;
  showHUD: (message: string) => Promise<unknown>;
  showFailureToast: (message: string) => Promise<unknown>;
  refresh: () => Promise<unknown> | void;
}

const MESSAGE_MAX = 200;

let inFlight = false;

function errorMessage(err: unknown): string {
  return err instanceof FylgjaError ? err.message : "Fylgja could not focus that";
}

function errorKind(err: unknown): string | undefined {
  return err instanceof FylgjaError ? err.kind : undefined;
}

function line(message: string): string {
  return truncate(oneLine(message), MESSAGE_MAX);
}

function placeLabel(item: NavItem | undefined, target: GoTarget, fallback: string): string {
  const place = item?.places?.find((p) => p.kind === target.kind && p.ref === target.ref);
  return place?.label || fallback;
}

export async function runGo(target: GoTarget | undefined, item: NavItem | undefined, deps: GoDeps): Promise<void> {
  if (!target) return;
  if (inFlight) return;
  inFlight = true;
  try {
    try {
      await deps.checkSecret();
    } catch (err) {
      if (errorKind(err) !== "aborted") await deps.showFailureToast(line(errorMessage(err)));
      return;
    }

    try {
      await deps.closeMainWindow();
    } catch {
      // The window may already be closed.
    }

    let lastFailure: unknown;
    try {
      await deps.focus(target);
      return;
    } catch (err) {
      lastFailure = err;
    }

    let hud: string | undefined;
    if (errorKind(lastFailure) === "conflict" && target.kind === "session") {
      const fallback = [item?.go_ide, item?.go_terminal].find(
        (t): t is GoTarget => t !== undefined && t.kind === "window" && t.ref !== target.ref,
      );
      if (fallback) {
        try {
          await deps.focus(fallback);
          hud = `${placeLabel(item, target, "session")} has no window; opened ${placeLabel(item, fallback, "window")}`;
          lastFailure = undefined;
        } catch (err) {
          lastFailure = err;
        }
      }
    }

    if (lastFailure !== undefined) {
      if (errorKind(lastFailure) === "aborted") return;
      hud = errorMessage(lastFailure);
    }
    if (hud !== undefined) await deps.showHUD(line(hud));

    if (errorKind(lastFailure) === "not_found") {
      try {
        await deps.refresh();
      } catch {
        // The window is closed; nothing to show.
      }
    }
  } finally {
    inFlight = false;
  }
}
