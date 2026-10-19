import { describe, expect, it, vi } from "vitest";
import { FylgjaError, messages } from "../src/fylgja/errors";
import type { GoTarget, NavItem } from "../src/fylgja/types";
import { runGo, type GoDeps } from "../src/go";

const SESSION: GoTarget = { kind: "session", ref: "claude:abc" };
const WINDOW: GoTarget = { kind: "window", ref: "100" };
const TERMINAL: GoTarget = { kind: "window", ref: "200" };

function item(extra: Partial<NavItem> = {}): NavItem {
  return {
    id: "a01",
    key: "folder:/work/alpha/main",
    kind: "folder",
    name: "alpha/main",
    tickets: [],
    score: 1,
    explanation: "",
    parts: [],
    places: [
      { kind: "session", ref: "claude:abc", role: "agent", label: "claude", open: true, waiting: false },
      { kind: "window", ref: "100", role: "ide", label: "PyCharm", open: true, waiting: false },
      { kind: "window", ref: "200", role: "terminal", label: "Terminal", open: true, waiting: false },
    ],
    state: [],
    seconds_today: 0,
    summary: "",
    go: SESSION,
    go_ide: WINDOW,
    ...extra,
  };
}

const notFound = (target: "window" | "session") =>
  new FylgjaError("not_found", messages.not_found("gone", target), { status: 404 });
const conflict = () => new FylgjaError("conflict", "session has no window", { status: 409 });

function setup(focus: (t: GoTarget) => Promise<unknown> = async () => ({ focused: "window", via: "x" })) {
  const calls: string[] = [];
  const track = <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    vi.fn((...a: A) => {
      calls.push(name);
      return fn(...a);
    });
  const deps = {
    checkSecret: track("checkSecret", async () => undefined),
    closeMainWindow: track("closeMainWindow", async () => undefined),
    focus: track("focus", focus),
    showHUD: track("showHUD", async () => undefined),
    showFailureToast: track("showFailureToast", async () => undefined),
    refresh: track("refresh", async () => undefined),
  } satisfies GoDeps;
  return { deps, calls };
}

describe("runGo", () => {
  it("focuses after reading the secret and closing the window", async () => {
    const { deps, calls } = setup();
    await runGo(WINDOW, item(), deps);
    expect(calls).toEqual(["checkSecret", "closeMainWindow", "focus"]);
    expect(deps.focus).toHaveBeenCalledWith(WINDOW);
  });

  it("shows a toast and does not close or focus without a secret", async () => {
    const { deps } = setup();
    deps.checkSecret.mockRejectedValueOnce(new FylgjaError("no_secret", messages.no_secret("/s")));
    await runGo(WINDOW, item(), deps);
    expect(deps.showFailureToast).toHaveBeenCalledWith(messages.no_secret("/s"));
    expect(deps.closeMainWindow).not.toHaveBeenCalled();
    expect(deps.focus).not.toHaveBeenCalled();
    expect(deps.showHUD).not.toHaveBeenCalled();
  });

  it("falls back to go_ide for a windowless session", async () => {
    const { deps } = setup(async (t) => {
      if (t.kind === "session") throw conflict();
      return {};
    });
    await runGo(SESSION, item(), deps);
    expect(deps.focus).toHaveBeenCalledTimes(2);
    expect(deps.focus).toHaveBeenLastCalledWith(WINDOW);
    expect(deps.showHUD).toHaveBeenCalledWith("claude has no window; opened PyCharm");
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("falls back to go_terminal when there is no go_ide", async () => {
    const { deps } = setup(async (t) => {
      if (t.kind === "session") throw conflict();
      return {};
    });
    await runGo(SESSION, item({ go_ide: undefined, go_terminal: TERMINAL }), deps);
    expect(deps.focus).toHaveBeenLastCalledWith(TERMINAL);
    expect(deps.showHUD).toHaveBeenCalledWith("claude has no window; opened Terminal");
  });

  it("shows the conflict when there is no window to fall back to", async () => {
    const { deps } = setup(async () => {
      throw conflict();
    });
    await runGo(SESSION, item({ go_ide: undefined }), deps);
    expect(deps.focus).toHaveBeenCalledTimes(1);
    expect(deps.showHUD).toHaveBeenCalledWith("session has no window");
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("makes at most two focus calls and refreshes when the fallback is gone", async () => {
    const { deps, calls } = setup(async (t) => {
      throw t.kind === "session" ? conflict() : notFound("window");
    });
    await runGo(SESSION, item(), deps);
    expect(deps.focus).toHaveBeenCalledTimes(2);
    expect(deps.showHUD).toHaveBeenCalledWith("That window is gone");
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(calls.slice(-2)).toEqual(["showHUD", "refresh"]);
  });

  it("refreshes after a window that is gone, with no fallback", async () => {
    const { deps, calls } = setup(async () => {
      throw notFound("window");
    });
    await runGo(WINDOW, item(), deps);
    expect(deps.focus).toHaveBeenCalledTimes(1);
    expect(calls.slice(-3)).toEqual(["focus", "showHUD", "refresh"]);
    expect(deps.showHUD).toHaveBeenCalledWith("That window is gone");
  });

  it("refreshes after a session that has ended", async () => {
    const { deps } = setup(async () => {
      throw notFound("session");
    });
    await runGo(SESSION, item(), deps);
    expect(deps.showHUD).toHaveBeenCalledWith("That session has ended");
    expect(deps.refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores a refresh that rejects", async () => {
    const { deps } = setup(async () => {
      throw notFound("window");
    });
    deps.refresh.mockRejectedValueOnce(new Error("boom"));
    await expect(runGo(WINDOW, item(), deps)).resolves.toBeUndefined();
    expect(deps.showHUD).toHaveBeenCalledTimes(1);
    expect(deps.showFailureToast).not.toHaveBeenCalled();
  });

  it.each([
    ["upstream", messages.upstream("AeroSpace said no"), "AeroSpace said no"],
    ["unauthorized", messages.unauthorized(), "restart it"],
    ["daemon_down", messages.daemon_down("127.0.0.1:7319"), "not running"],
  ] as const)("shows a HUD for %s without refresh", async (kind, message, text) => {
    const { deps } = setup(async () => {
      throw new FylgjaError(kind, message);
    });
    await runGo(WINDOW, item(), deps);
    expect(deps.showHUD).toHaveBeenCalledTimes(1);
    expect(deps.showHUD).toHaveBeenCalledWith(expect.stringContaining(text));
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("shows nothing for an abort", async () => {
    const { deps } = setup(async () => {
      throw new FylgjaError("aborted", messages.aborted());
    });
    await runGo(WINDOW, item(), deps);
    expect(deps.showHUD).not.toHaveBeenCalled();
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("makes one focus call for two overlapping runs", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps } = setup(async () => {
      await gate;
      return {};
    });
    const first = runGo(WINDOW, item(), deps);
    const second = runGo(WINDOW, item(), deps);
    release();
    await Promise.all([first, second]);
    expect(deps.focus).toHaveBeenCalledTimes(1);
    await runGo(WINDOW, item(), deps);
    expect(deps.focus).toHaveBeenCalledTimes(2);
  });

  it("still focuses when closeMainWindow rejects", async () => {
    const { deps } = setup();
    deps.closeMainWindow.mockRejectedValueOnce(new Error("nope"));
    await runGo(WINDOW, item(), deps);
    expect(deps.focus).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a target", async () => {
    const { deps, calls } = setup();
    await runGo(undefined, item(), deps);
    expect(calls).toEqual([]);
  });
});
