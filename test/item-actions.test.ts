import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Items, ItemPlace, NavItem } from "../src/fylgja/types";
import { RESERVED_SHORTCUTS, itemActions, type ItemActionDescriptor } from "../src/item-actions";

function load(name: string): Items {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as Items;
}

const fixtureItems = [...load("items.json").items, ...load("items-edge.json").items];

const place = (extra: Partial<ItemPlace> = {}): ItemPlace => ({
  kind: "window",
  ref: "100",
  role: "ide",
  label: "PyCharm",
  open: true,
  waiting: false,
  ...extra,
});

function item(extra: Partial<NavItem> = {}): NavItem {
  return {
    id: "x1",
    key: "folder:/work/x",
    kind: "folder",
    name: "alpha/main",
    tickets: [],
    score: 1,
    explanation: "",
    parts: [],
    places: [],
    state: [],
    seconds_today: 0,
    summary: "",
    ...extra,
  };
}

const titles = (i: NavItem) => itemActions(i).map((a) => a.title);
const go = { kind: "window", ref: "100" } as const;

describe("itemActions", () => {
  it("gives an item with only go: Go, Toggle Details, Refresh", () => {
    expect(titles(item({ go }))).toEqual(["Go", "Toggle Details", "Refresh"]);
  });

  it("adds Focus Place when an open place exists", () => {
    expect(titles(item({ go, places: [place()] }))).toEqual(["Go", "Toggle Details", "Focus Place", "Refresh"]);
  });

  it("lists the three role targets in order with ⌘1/⌘2/⌘3, even when one equals go", () => {
    const actions = itemActions(
      item({
        go,
        go_ide: go,
        go_agent: { kind: "session", ref: "claude:a" },
        go_terminal: { kind: "window", ref: "101" },
      }),
    );
    expect(actions.map((a) => a.title)).toEqual([
      "Go",
      "Toggle Details",
      "Go to IDE",
      "Go to Agent",
      "Go to Terminal",
      "Refresh",
    ]);
    expect(actions.slice(2, 5).map((a) => a.shortcut)).toEqual([
      { modifiers: ["cmd"], key: "1" },
      { modifiers: ["cmd"], key: "2" },
      { modifiers: ["cmd"], key: "3" },
    ]);
    expect(actions[2]!.target).toEqual(go);
  });

  it("gives only Go to Terminal when only go_terminal exists", () => {
    const t = titles(item({ go_terminal: { kind: "window", ref: "9" } }));
    expect(t).toContain("Go to Terminal");
    expect(t).not.toContain("Go to IDE");
    expect(t).not.toContain("Go to Agent");
  });

  it("without go has no Go, no role actions and no Focus Place; Toggle Details is first; Copy Path for a folder", () => {
    const actions = itemActions(item({ path: "/work/alpha/main", places: [place({ open: false })] }));
    expect(actions.map((a) => a.title)).toEqual(["Toggle Details", "Copy Path", "Refresh"]);
    expect(actions.find((a) => a.title === "Copy Path")!.copy).toBe("/work/alpha/main");
  });

  it("has no Copy Path for an app item", () => {
    expect(titles(item({ kind: "app", key: "app:com.example.slack", go }))).not.toContain("Copy Path");
  });

  it("lists the open places in order with the documented labels", () => {
    const places = [
      place({ ref: "1", label: "PyCharm", title: "Window title 1", workspace: "3" }),
      place({ ref: "2", label: "Terminal", workspace: "2" }),
      place({ ref: "3", label: "Safari", title: "Window title 3" }),
      place({ ref: "4", open: false }),
      place({ ref: "5", open: false }),
      place({ ref: "6", open: false }),
      place({ ref: "7", open: false }),
      place({ ref: "8", open: false }),
    ];
    const submenu = itemActions(item({ go, places })).find((a) => a.kind === "focus-place")!;
    expect(submenu.shortcut).toEqual({ modifiers: ["cmd"], key: "g" });
    expect(submenu.places!.map((p) => p.title)).toEqual([
      "PyCharm — Window title 1 (ws 3)",
      "Terminal (ws 2)",
      "Safari — Window title 3",
    ]);
    expect(submenu.places!.map((p) => p.target.ref)).toEqual(["1", "2", "3"]);
  });

  it("cuts a 207-character title and keeps the entry on one line", () => {
    const submenu = itemActions(item({ places: [place({ title: `a\nb${"x".repeat(205)}`, workspace: "1" })] })).find(
      (a) => a.kind === "focus-place",
    )!;
    const title = submenu.places![0]!.title;
    expect(Array.from(title)).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("\n");
  });

  it("has no submenu with zero open places", () => {
    expect(titles(item({ places: [place({ open: false })] }))).not.toContain("Focus Place");
  });

  it("gives one ticket a single Copy Ticket and several a submenu", () => {
    const one = itemActions(item({ tickets: ["CBS-1"] })).find((a) => a.kind === "copy-ticket")!;
    expect(one.copy).toBe("CBS-1");
    expect(one.tickets).toBeUndefined();
    const four = itemActions(item({ tickets: ["CBS-1", "CBS-2", "CBS-3", "CBS-4"] })).find(
      (a) => a.kind === "copy-ticket",
    )!;
    expect(four.tickets!.map((t) => t.text)).toEqual(["CBS-1", "CBS-2", "CBS-3", "CBS-4"]);
    expect(four.shortcut).toEqual({ common: "Copy" });
  });

  it("has Copy Ranker Explanation only with an explanation, before Refresh", () => {
    expect(titles(item())).not.toContain("Copy Ranker Explanation");
    const actions = itemActions(item({ explanation: "focus 22 · turn done +90" }));
    expect(actions.map((a) => a.title).slice(-2)).toEqual(["Copy Ranker Explanation", "Refresh"]);
    expect(actions.find((a) => a.kind === "copy-explanation")!.copy).toBe("focus 22 · turn done +90");
  });

  describe("Summarize", () => {
    const withSummaries = (i: NavItem) => itemActions(i, true);

    it("is absent when summaries are off", () => {
      expect(titles(item({ go }))).not.toContain("Summarize");
      expect(itemActions(item({ go }), false).map((a) => a.title)).not.toContain("Summarize");
    });

    it("comes right after Toggle Details with ⌘S, with and without a story", () => {
      for (const i of [item({ go }), item({ go, story: { state: "fresh", text: "Sentence one." } })]) {
        const actions = withSummaries(i);
        const at = actions.findIndex((a) => a.title === "Toggle Details");
        expect(actions[at + 1]!.title).toBe("Summarize");
        expect(actions[at + 1]!.shortcut).toEqual({ modifiers: ["cmd"], key: "s" });
      }
    });

    it("keeps shortcuts unique and unreserved over every fixture item", () => {
      const reserved = new Set(RESERVED_SHORTCUTS.map((s) => JSON.stringify(s)));
      for (const it of fixtureItems) {
        const keys = withSummaries(it)
          .map((a) => (a.shortcut ? JSON.stringify(a.shortcut) : undefined))
          .filter((k) => k !== undefined);
        expect(new Set(keys).size, it.name).toBe(keys.length);
        expect(
          keys.filter((k) => reserved.has(k)),
          it.name,
        ).toEqual([]);
      }
    });
  });

  describe("over every fixture item", () => {
    const small = new Set(["a", "an", "as", "in", "of", "to", "the", "and", "or", "on"]);
    const key = (a: ItemActionDescriptor) => (a.shortcut ? JSON.stringify(a.shortcut) : undefined);
    const reserved = new Set(RESERVED_SHORTCUTS.map((s) => JSON.stringify(s)));

    it("covers the fixtures", () => {
      expect(fixtureItems.length).toBeGreaterThan(5);
    });

    it("never shares a shortcut within one panel", () => {
      for (const it of fixtureItems) {
        const keys = itemActions(it)
          .map(key)
          .filter((k) => k !== undefined);
        expect(new Set(keys).size, it.name).toBe(keys.length);
      }
    });

    it("never uses a reserved shortcut", () => {
      for (const it of fixtureItems) {
        for (const a of itemActions(it)) {
          if (a.shortcut) expect(reserved.has(JSON.stringify(a.shortcut)), `${it.name}: ${a.title}`).toBe(false);
        }
      }
    });

    it("uses Title Case titles", () => {
      for (const it of fixtureItems) {
        for (const a of itemActions(it)) {
          a.title.split(" ").forEach((word, i) => {
            const ok = i === 0 || !small.has(word) ? /^[A-Z0-9]/.test(word) : true;
            expect(ok, `${a.title}: ${word}`).toBe(true);
          });
        }
      }
    });
  });
});
