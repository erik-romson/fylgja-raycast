import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { firstSentence } from "../src/format";
import { FylgjaError, messages } from "../src/fylgja/errors";
import type { JournalThread } from "../src/fylgja/journal-types";
import { menubarModel, type MenubarModel } from "../src/journal/menubar-model";

function fixture(name: string): JournalThread {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as JournalThread;
}

const base = fixture("journal-thread.json");
const points = (s: string) => Array.from(s).length;

function withWhere(where: JournalThread["where"], extra: Partial<JournalThread> = {}): JournalThread {
  return { ...base, ...extra, where };
}

describe("firstSentence", () => {
  it("returns the first sentence", () => {
    expect(firstSentence("Fixing the login. Next step is X.", 40)).toBe("Fixing the login.");
  });

  it("does not cut at versions, abbreviations or file names", () => {
    expect(firstSentence("Updated v1.2.3 and e.g. foo.ts. Then bar.", 60)).toBe("Updated v1.2.3 and e.g. foo.ts.");
  });

  it("cuts a long text without a stop on a word boundary with an ellipsis", () => {
    const text = Array.from({ length: 33 }, (_, i) => `word${i % 10}`).join(" ");
    expect(points(text)).toBeGreaterThan(190);
    const out = firstSentence(text, 40);
    expect(out.endsWith("…")).toBe(true);
    expect(points(out)).toBeLessThanOrEqual(40);
    expect(text.startsWith(out.slice(0, -1))).toBe(true);
  });

  it("cuts a sentence that is longer than max", () => {
    const out = firstSentence("This sentence is far too long to fit in forty code points. Next.", 40);
    expect(out.endsWith("…")).toBe(true);
    expect(points(out)).toBeLessThanOrEqual(40);
  });

  it("ends at ! and ? and at the end of the text", () => {
    expect(firstSentence("Done! Now what", 40)).toBe("Done!");
    expect(firstSentence("Why? 2 reasons", 40)).toBe("Why?");
    expect(firstSentence("Only one.", 40)).toBe("Only one.");
  });

  it("gives an empty string for empty, undefined and punctuation-only input", () => {
    expect(firstSentence("", 40)).toBe("");
    expect(firstSentence(".", 40)).toBe("");
    expect(firstSentence(undefined, 40)).toBe("");
  });

  it("takes the first line and drops markdown markers", () => {
    expect(firstSentence("## Heading\nmore", 40)).toBe("Heading");
    expect(firstSentence("> - Quoted item. More.", 40)).toBe("Quoted item.");
    expect(firstSentence("1. First step. Second.", 40)).toBe("First step.");
  });
});

function expectTitleRules(model: MenubarModel) {
  if (model.title !== undefined) {
    expect(model.title).not.toMatch(/[\r\n]/);
    expect(points(model.title)).toBeLessThanOrEqual(40);
  }
}

describe("menubarModel", () => {
  it("uses the first sentence of a fresh Where text as the title", () => {
    const m = menubarModel({
      kind: "thread",
      thread: withWhere({ state: "fresh", text: "Sentence one. Sentence two." }),
    });
    expect(m.title).toBe("Sentence one.");
    expect(m.tooltip).toBe("Sentence one. Sentence two.");
    const titles = m.items.map((i) => i.title);
    expect(titles[0]).toBe(`${base.folder} · ${base.branch}`);
    expect(titles[1]).toBe("Sentence one. Sentence two.");
    expect(titles.slice(-2)).toEqual(["Open Fylgja Journal", "Refresh"]);
    expect(m.items.slice(-2).map((i) => i.kind)).toEqual(["open-journal", "refresh"]);
    const shown = base.open.next.filter((i) => i.shown).map((i) => i.text);
    expect(titles.slice(2, -2)).toEqual(shown);
    expectTitleRules(m);
  });

  it("cuts the Where text in the menu at 200 code points", () => {
    const text = "x".repeat(300);
    const m = menubarModel({ kind: "thread", thread: withWhere({ state: "fresh", text }) });
    expect(points(m.items[1].title)).toBe(200);
    expect(m.items[1].title.endsWith("…")).toBe(true);
    expectTitleRules(m);
  });

  it("keeps the title and marks the tooltip for pending with text", () => {
    const m = menubarModel({ kind: "thread", thread: withWhere({ state: "pending", text: "Working on it. More." }) });
    expect(m.title).toBe("Working on it.");
    expect(m.tooltip).toContain("Working on it. More.");
    expect(m.tooltip).toContain("updating…");
  });

  it("has no title and says it is writing for pending without text", () => {
    const m = menubarModel({ kind: "thread", thread: withWhere({ state: "pending" }) });
    expect(m.title).toBeUndefined();
    expect(m.tooltip).toBe("Writing an entry");
  });

  it("keeps the title and shows the failure for failed with text", () => {
    const m = menubarModel({
      kind: "thread",
      thread: withWhere({ state: "failed", text: "Old entry." }, { error_kind: "timeout" }),
    });
    expect(m.title).toBe("Old entry.");
    expect(m.tooltip).toContain("Old entry.");
    expect(m.tooltip).toContain("last attempt failed: timeout");
  });

  it("has no title and names the failure for failed without text", () => {
    const m = menubarModel({ kind: "thread", thread: withWhere({ state: "failed" }, { error_kind: "timeout" }) });
    expect(m.title).toBeUndefined();
    expect(m.tooltip).toBe("Last attempt failed: timeout");
  });

  it("has no title and says no entry yet for missing", () => {
    const m = menubarModel({ kind: "thread", thread: withWhere({ state: "missing" }) });
    expect(m.title).toBeUndefined();
    expect(m.tooltip).toBe("No entry yet");
  });

  it("has no title and one disabled item for an empty journal", () => {
    const m = menubarModel({ kind: "empty", detail: "nothing is focused" });
    expect(m.title).toBeUndefined();
    expect(m.items).toEqual([{ kind: "info", title: "nothing is focused", disabled: true }]);
  });

  it("has no title and says the journal is off", () => {
    const m = menubarModel({ kind: "off" });
    expect(m.title).toBeUndefined();
    expect(m.items.map((i) => i.title)).toEqual(["The journal is off in Fylgja"]);
  });

  it.each([
    ["daemon_down", messages.daemon_down("127.0.0.1:7319")],
    ["timeout", messages.timeout(4)],
    ["route_missing", messages.route_missing()],
  ] as const)("shows only the R6 message for %s", (kind, message) => {
    const m = menubarModel(new FylgjaError(kind, message));
    expect(m.title).toBeUndefined();
    expect(m.tooltip).toBe(message);
    expect(m.items).toHaveLength(1);
    expect(m.items[0].title).toBe(message);
  });

  it("keeps no earlier title: the result alone decides", () => {
    const good = menubarModel({ kind: "thread", thread: withWhere({ state: "fresh", text: "Sentence one." }) });
    expect(good.title).toBe("Sentence one.");
    const after = menubarModel(new FylgjaError("daemon_down", messages.daemon_down("127.0.0.1:7319")));
    expect(after.title).toBeUndefined();
    expect(menubarModel({ kind: "empty", detail: "nothing is focused" }).title).toBeUndefined();
  });

  it("has only the fields title, tooltip and items (no toast output)", () => {
    const m = menubarModel(new FylgjaError("timeout", messages.timeout(4)));
    expect(Object.keys(m).sort()).toEqual(["items", "tooltip"]);
  });

  it("keeps single-line strings on one line", () => {
    const m = menubarModel({
      kind: "thread",
      thread: withWhere({ state: "fresh", text: "Line one.\nLine two with\ttab." }, { name: "a\nb" }),
    });
    for (const item of m.items) expect(item.title).not.toMatch(/[\r\n\t]/);
    expect(m.tooltip).not.toMatch(/[\r\n\t]/);
    expectTitleRules(m);
  });
});
