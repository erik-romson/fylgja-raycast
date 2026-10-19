import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, type Mock } from "vitest";
import { FylgjaError, messages, type FylgjaErrorKind } from "../src/fylgja/errors";
import type { JournalItem, JournalThread } from "../src/fylgja/journal-types";
import {
  runJournalAction,
  runOpenSource,
  type ActionDeps,
  type OpenSourceDeps,
  type RunnableAction,
  type ToastAction,
} from "../src/journal/actions";

const thread = JSON.parse(readFileSync(join(__dirname, "fixtures", "journal-thread.json"), "utf8")) as JournalThread;
const items = [
  ...thread.open.next,
  ...thread.open.remember,
  ...thread.open.blocked,
  ...thread.done_recent.flatMap((d) => d.items),
];
const byId = (id: string) => items.find((i) => i.id === id) as JournalItem;
const unpinned = byId("n3");
const pinned = byId("n1");
const withTodo = byId("n2");
const done = byId("d1");

type Spies<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : T[K] };

function makeDeps(overrides: Partial<ActionDeps> = {}) {
  const calls: string[] = [];
  const deps: Spies<ActionDeps> = {
    patchItem: vi.fn<ActionDeps["patchItem"]>(async () => {
      calls.push("request");
    }),
    makeTodo: vi.fn<ActionDeps["makeTodo"]>(async () => {
      calls.push("request");
      return { created: true };
    }),
    refetch: vi.fn<ActionDeps["refetch"]>(() => {
      calls.push("refetch");
    }),
    showToast: vi.fn<ActionDeps["showToast"]>(() => {
      calls.push("toast");
    }),
    showFailureToast: vi.fn<ActionDeps["showFailureToast"]>(() => {
      calls.push("failure");
    }),
    ...(overrides as Partial<Spies<ActionDeps>>),
  };
  return { deps, calls };
}

function err(kind: FylgjaErrorKind, message: string) {
  return new FylgjaError(kind, message);
}

describe("runJournalAction requests", () => {
  it("Mark as Done patches status done", async () => {
    const { deps, calls } = makeDeps();
    await runJournalAction("mark-done", unpinned, deps);
    expect(deps.patchItem).toHaveBeenCalledExactlyOnceWith("n3", { status: "done" });
    expect(calls).toEqual(["request", "refetch"]);
  });

  it("Pin and Unpin flip pinned", async () => {
    const a = makeDeps();
    await runJournalAction("pin", unpinned, a.deps);
    expect(a.deps.patchItem).toHaveBeenCalledExactlyOnceWith("n3", { pinned: true });
    const b = makeDeps();
    await runJournalAction("pin", pinned, b.deps);
    expect(b.deps.patchItem).toHaveBeenCalledExactlyOnceWith("n1", { pinned: false });
    expect(b.calls).toEqual(["request", "refetch"]);
  });

  it("Drop patches dropped, toasts with Undo, then refetches; Undo reopens", async () => {
    const { deps, calls } = makeDeps();
    await runJournalAction("drop", unpinned, deps);
    expect(deps.patchItem).toHaveBeenCalledExactlyOnceWith("n3", { status: "dropped" });
    expect(calls).toEqual(["request", "toast", "refetch"]);
    const toast = deps.showToast.mock.calls[0][0] as { title: string; action: ToastAction };
    expect(toast.title).toBe("Dropped");
    expect(toast.action.title).toBe("Undo");
    await toast.action.run();
    expect(deps.patchItem).toHaveBeenLastCalledWith("n3", { status: "open" });
    expect(deps.patchItem).toHaveBeenCalledTimes(2);
    expect(deps.refetch).toHaveBeenCalledTimes(2);
  });

  it("Make a Todo and Todo Exists call makeTodo only", async () => {
    const a = makeDeps();
    await runJournalAction("make-todo", unpinned, a.deps);
    expect(a.deps.makeTodo).toHaveBeenCalledExactlyOnceWith("n3");
    expect(a.deps.patchItem).not.toHaveBeenCalled();
    expect(a.deps.showToast).toHaveBeenCalledWith({ title: "Todo made" });
    expect(a.calls).toEqual(["request", "toast", "refetch"]);
    const b = makeDeps({ makeTodo: vi.fn(async () => ({ created: false })) });
    await runJournalAction("todo-exists", withTodo, b.deps);
    expect(b.deps.makeTodo).toHaveBeenCalledExactlyOnceWith("n2");
    expect(b.deps.patchItem).not.toHaveBeenCalled();
    expect(b.deps.showToast).toHaveBeenCalledWith({ title: "The todo already exists" });
    expect(b.deps.refetch).toHaveBeenCalledOnce();
  });

  it("Refresh makes no request and refetches once", async () => {
    const { deps } = makeDeps();
    await runJournalAction("refresh", unpinned, deps);
    expect(deps.patchItem).not.toHaveBeenCalled();
    expect(deps.makeTodo).not.toHaveBeenCalled();
    expect(deps.refetch).toHaveBeenCalledOnce();
  });
});

describe("runJournalAction failures", () => {
  const failures: [FylgjaErrorKind, string][] = [
    ["not_found", "No such item"],
    ["unauthorized", messages.unauthorized()],
    ["no_secret", messages.no_secret("/x/secret")],
    ["journal_off", messages.journal_off()],
    ["unprocessable", "Bad patch"],
    ["daemon_down", messages.daemon_down("127.0.0.1:7319")],
  ];
  const requesting: [RunnableAction, JournalItem][] = [
    ["mark-done", unpinned],
    ["pin", unpinned],
    ["drop", unpinned],
    ["make-todo", unpinned],
    ["todo-exists", withTodo],
  ];

  for (const [action, item] of requesting) {
    for (const [kind, message] of failures) {
      it(`${action} with ${kind} shows the message and does not refetch`, async () => {
        const failing = vi.fn(async (): Promise<never> => {
          throw err(kind, message);
        });
        const { deps } = makeDeps({ patchItem: failing, makeTodo: failing });
        await runJournalAction(action, item, deps);
        expect(failing).toHaveBeenCalledOnce();
        expect(deps.showFailureToast).toHaveBeenCalledExactlyOnceWith(message);
        expect(deps.refetch).not.toHaveBeenCalled();
        expect(deps.showToast).not.toHaveBeenCalled();
      });
    }

    it(`${action} aborted shows nothing`, async () => {
      const failing = vi.fn(async (): Promise<never> => {
        throw err("aborted", messages.aborted());
      });
      const { deps } = makeDeps({ patchItem: failing, makeTodo: failing });
      await runJournalAction(action, item, deps);
      expect(deps.showFailureToast).not.toHaveBeenCalled();
      expect(deps.refetch).not.toHaveBeenCalled();
    });
  }

  it("refuses actions a Done lately item does not offer", async () => {
    for (const action of ["mark-done", "pin", "drop"] as const) {
      const { deps } = makeDeps();
      await runJournalAction(action, done, deps);
      expect(deps.patchItem).not.toHaveBeenCalled();
      expect(deps.refetch).not.toHaveBeenCalled();
      expect(deps.showFailureToast).toHaveBeenCalledOnce();
      expect(deps.showFailureToast.mock.calls[0][0]).toMatch(/^Extension bug: /);
    }
  });

  it("refuses Make a Todo on an item that already has one", async () => {
    const { deps } = makeDeps();
    await runJournalAction("make-todo", withTodo, deps);
    expect(deps.makeTodo).not.toHaveBeenCalled();
    expect(deps.showFailureToast).toHaveBeenCalledOnce();
  });
});

function makeOpenDeps(overrides: Partial<OpenSourceDeps> = {}) {
  const deps: Spies<OpenSourceDeps> = {
    checkSecret: vi.fn<OpenSourceDeps["checkSecret"]>(async () => "token"),
    focus: vi.fn<OpenSourceDeps["focus"]>(async () => ({ focused: "window" })),
    closeMainWindow: vi.fn<OpenSourceDeps["closeMainWindow"]>(async () => {}),
    open: vi.fn<OpenSourceDeps["open"]>(async () => {}),
    showFailureToast: vi.fn<OpenSourceDeps["showFailureToast"]>(async () => {}),
    baseUrl: "http://127.0.0.1:7319",
    ...(overrides as Partial<Spies<OpenSourceDeps>>),
  };
  return deps;
}

describe("runOpenSource with a session", () => {
  it("checks the secret, focuses with the window open, then closes", async () => {
    const order: string[] = [];
    const deps = makeOpenDeps({
      checkSecret: vi.fn(async () => {
        order.push("checkSecret");
      }),
      focus: vi.fn(async () => {
        order.push("focus");
      }),
      closeMainWindow: vi.fn(async () => {
        order.push("close");
      }),
    });
    await runOpenSource({ focus: "claude:abc" }, deps);
    expect(order).toEqual(["checkSecret", "focus", "close"]);
    expect(deps.focus).toHaveBeenCalledWith({ kind: "session", ref: "claude:abc" });
    expect(deps.showFailureToast).not.toHaveBeenCalled();
  });

  for (const kind of ["not_found", "conflict"] as const) {
    it(`${kind} shows a toast with Open Fylgja Page and keeps the window`, async () => {
      const deps = makeOpenDeps({
        focus: vi.fn(async (): Promise<never> => {
          throw err(kind, "That session has ended");
        }),
      });
      await runOpenSource({ focus: "claude:abc" }, deps);
      expect(deps.closeMainWindow).not.toHaveBeenCalled();
      expect(deps.open).not.toHaveBeenCalled();
      const [message, action] = deps.showFailureToast.mock.calls[0] as [string, ToastAction];
      expect(message).toBe("That session has ended");
      expect(action.title).toBe("Open Fylgja Page");
      await action.run();
      expect(deps.open).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:7319/");
    });
  }

  it("a missing secret shows its message and neither focuses nor closes", async () => {
    const message = messages.no_secret("/x/secret");
    const deps = makeOpenDeps({
      checkSecret: vi.fn(async (): Promise<never> => {
        throw err("no_secret", message);
      }),
    });
    await runOpenSource({ focus: "claude:abc" }, deps);
    expect(deps.showFailureToast).toHaveBeenCalledExactlyOnceWith(message, undefined);
    expect(deps.focus).not.toHaveBeenCalled();
    expect(deps.closeMainWindow).not.toHaveBeenCalled();
  });

  for (const [kind, message] of [
    ["daemon_down", messages.daemon_down("127.0.0.1:7319")],
    ["unauthorized", messages.unauthorized()],
  ] as const) {
    it(`${kind} shows its message without the page action`, async () => {
      const deps = makeOpenDeps({
        focus: vi.fn(async (): Promise<never> => {
          throw err(kind, message);
        }),
      });
      await runOpenSource({ focus: "claude:abc" }, deps);
      expect(deps.showFailureToast).toHaveBeenCalledExactlyOnceWith(message, undefined);
      expect(deps.closeMainWindow).not.toHaveBeenCalled();
    });
  }

  it("ignores a closeMainWindow rejection after success", async () => {
    const deps = makeOpenDeps({
      closeMainWindow: vi.fn(async (): Promise<never> => {
        throw new Error("already closed");
      }),
    });
    await expect(runOpenSource({ focus: "claude:abc" }, deps)).resolves.toBeUndefined();
    expect(deps.showFailureToast).not.toHaveBeenCalled();
  });

  it("ignores a second call while the first is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = makeOpenDeps({ focus: vi.fn(() => gate) });
    const first = runOpenSource({ focus: "claude:abc" }, deps);
    const second = runOpenSource({ focus: "claude:abc" }, deps);
    await second;
    release();
    await first;
    expect(deps.focus).toHaveBeenCalledOnce();
  });
});

describe("runOpenSource with a file or a refusal", () => {
  it("opens the file, then closes the window", async () => {
    const order: string[] = [];
    const deps = makeOpenDeps({
      open: vi.fn(async () => {
        order.push("open");
      }),
      closeMainWindow: vi.fn(async () => {
        order.push("close");
      }),
    });
    await runOpenSource({ open: "/work/alpha/main/src/a.ts" }, deps);
    expect(deps.open).toHaveBeenCalledWith("/work/alpha/main/src/a.ts");
    expect(order).toEqual(["open", "close"]);
    expect(deps.focus).not.toHaveBeenCalled();
  });

  it("a failing open shows a toast and keeps the window", async () => {
    const deps = makeOpenDeps({
      open: vi.fn(async (): Promise<never> => {
        throw new Error("no such app");
      }),
    });
    await runOpenSource({ open: "/work/alpha/main/src/a.ts" }, deps);
    expect(deps.showFailureToast).toHaveBeenCalledOnce();
    expect(deps.closeMainWindow).not.toHaveBeenCalled();
  });

  it("a refusal shows its message and calls nothing else", async () => {
    const deps = makeOpenDeps();
    await runOpenSource({ refuse: "That file is outside the checkout" }, deps);
    expect(deps.showFailureToast).toHaveBeenCalledExactlyOnceWith("That file is outside the checkout");
    expect(deps.checkSecret).not.toHaveBeenCalled();
    expect(deps.focus).not.toHaveBeenCalled();
    expect(deps.open).not.toHaveBeenCalled();
    expect(deps.closeMainWindow).not.toHaveBeenCalled();
  });
});
