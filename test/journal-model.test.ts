import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { escapeMarkdown } from "../src/format";
import type { JournalHow, JournalItem, JournalThread } from "../src/fylgja/journal-types";
import { RESERVED_SHORTCUTS } from "../src/item-actions";
import {
  banner,
  howMarkdown,
  journalActions,
  journalSections,
  journalView,
  navigationTitle,
  refreshOnlyActions,
  rowDetail,
  whereText,
} from "../src/journal/model";

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as T;
}

const NOW = new Date(2026, 9, 19, 12, 0, 0);
const thread = fixture<JournalThread>("journal-thread.json");
const empty = fixture<JournalThread>("journal-empty.json");
const whereOnly = fixture<JournalThread>("journal-where-only.json");

function allItems(t: JournalThread): JournalItem[] {
  return [...t.open.next, ...t.open.remember, ...t.open.blocked, ...t.done_recent.flatMap((d) => d.items)];
}

describe("journalSections", () => {
  const sections = journalSections(thread, NOW);

  it("keeps the order Do next, Keep in mind, Blocked, then one section per day", () => {
    expect(sections.map((s) => s.title)).toEqual([
      "Do next",
      "Keep in mind",
      "Blocked",
      "Today",
      "Yesterday",
      "Fri 16 Oct",
    ]);
  });

  it("lists every open item in the order sent, shown or not", () => {
    expect(sections[0].rows.map((r) => r.item?.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(sections[2].rows.map((r) => r.item?.id)).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("marks pinned items", () => {
    expect(sections[0].rows.map((r) => r.pinned)).toEqual([true, false, false, false]);
    expect(sections[2].rows[0].pinned).toBe(true);
  });

  it("puts headlines before the done items", () => {
    expect(sections[3].rows.map((r) => r.title)).toEqual(["Headline 1", "Headline 2", "Done: Item text 10"]);
    expect(sections[3].rows.map((r) => r.kind)).toEqual(["headline", "headline", "item"]);
  });

  it("omits empty sections", () => {
    expect(journalSections(empty, NOW)).toEqual([]);
  });
});

describe("journalView", () => {
  it("is rows for a full thread", () => {
    expect(journalView(thread, NOW).kind).toBe("rows");
  });

  it("is empty with the name and the Where description", () => {
    expect(journalView(empty, NOW)).toEqual({
      kind: "empty",
      title: "No journal entries yet for alpha/main",
      description: "Nothing yet",
    });
  });

  it("is where-only when only the Where text exists", () => {
    const view = journalView(whereOnly, NOW);
    if (view.kind !== "where-only") throw new Error(`got ${view.kind}`);
    expect(view.row.id).toBe("where");
    expect(view.row.title).toBe("Where you are");
    expect(view.row.subtitle).toBe("Sentence one. Sentence two. Sentence three.");
    expect(view.row.detail).toContain(escapeMarkdown("Sentence one. Sentence two. Sentence three."));
    expect(refreshOnlyActions().map((a) => a.title)).toEqual(["Refresh"]);
  });

  it("cuts the where-only subtitle at 80 code points", () => {
    const long = { ...whereOnly, where: { state: "fresh", text: "x".repeat(200) } };
    const view = journalView(long, NOW);
    if (view.kind !== "where-only") throw new Error("not where-only");
    expect(Array.from(view.row.subtitle ?? "")).toHaveLength(80);
  });

  it("shows updating… for a pending Where with text", () => {
    const view = journalView({ ...whereOnly, where: { state: "pending", text: "Sentence one." } }, NOW);
    if (view.kind !== "where-only") throw new Error("not where-only");
    expect(view.row.detail).toContain("updating…");
  });

  it("is empty with 'Writing an entry' for a pending Where without text", () => {
    const view = journalView({ ...whereOnly, where: { state: "pending" } }, NOW);
    expect(view).toMatchObject({ kind: "empty", description: "Writing an entry" });
  });

  it("puts the banner in the where-only detail", () => {
    const view = journalView({ ...whereOnly, error_kind: "timeout" }, NOW);
    if (view.kind !== "where-only") throw new Error("not where-only");
    expect(view.row.detail).toContain("Last attempt failed: timeout");
  });
});

describe("whereText and banner", () => {
  it("covers the six cases", () => {
    expect(whereText({ state: "fresh", text: "Text." })).toBe("Text.");
    expect(whereText({ state: "pending", text: "Text." })).toBe("Text. (updating…)");
    expect(whereText({ state: "pending" })).toBe("Writing an entry");
    expect(whereText({ state: "failed", text: "Text." })).toBe("Text. (last attempt failed)");
    expect(whereText({ state: "failed" })).toBe("Last attempt failed");
    expect(whereText({ state: "missing" })).toBe("Nothing yet");
  });

  it("makes a banner from the thread error_kind", () => {
    expect(banner({ ...thread, error_kind: "timeout" })).toBe("Last attempt failed: timeout");
    expect(banner(thread)).toBeUndefined();
  });

  it("rowDetail names a failed attempt once, with its kind", () => {
    const failed = { ...thread, where: { state: "failed", text: "Four commits." }, error_kind: "bad_output" };
    const row = journalSections(failed as JournalThread, NOW)[0].rows[0];
    const detail = rowDetail(failed as JournalThread, row);
    expect(detail).toContain("Last attempt failed: bad\\_output");
    expect(detail).not.toContain("(last attempt failed)");
    expect(detail).toContain("Four commits.");
  });

  it("rowDetail leads with the checkout and the item's whole text, then the source, How state and Where you are", () => {
    const row = journalSections(thread, NOW)[0].rows[1];
    const detail = rowDetail(thread, row);
    expect(detail.startsWith(`## ${navigationTitle(thread)}`)).toBe(true);
    expect(detail).toContain(row.item!.text);
    expect(detail.indexOf(row.item!.text)).toBeLessThan(detail.indexOf("Source"));
    expect(detail.indexOf("Source")).toBeLessThan(detail.indexOf("Where you are"));
    expect(detail).toContain("file: notes.md");
    expect(detail).toContain("/work/alpha/main/notes.md");
    expect(detail).toContain("no checklist yet");
  });
});

describe("journalActions", () => {
  const byId = (id: string) => allItems(thread).find((i) => i.id === id) as JournalItem;
  const titles = (item: JournalItem) => journalActions(item).map((a) => a.title);

  it("offers Pin for an unpinned item and Unpin for a pinned one", () => {
    expect(titles(byId("n2"))).toContain("Pin");
    expect(titles(byId("n1"))).toContain("Unpin");
  });

  it("titles Make a Todo 'Todo Exists' when a todo is linked", () => {
    expect(titles(byId("n2"))).toContain("Todo Exists");
    expect(titles(byId("n2"))).not.toContain("Make a Todo");
    expect(titles(byId("n1"))).toContain("Make a Todo");
  });

  it("has no Open Source for a commit source", () => {
    expect(titles(byId("n4"))).not.toContain("Open Source");
    expect(titles(byId("n1"))).toContain("Open Source");
  });

  it("offers a done item Open Source and Refresh only", () => {
    expect(titles(byId("d1"))).toEqual(["Open Source", "Refresh"]);
  });

  it("puts How first and Mark as Done second, with Drop destructive", () => {
    const actions = journalActions(byId("n1"));
    expect(actions.slice(0, 2).map((a) => a.title)).toEqual(["How Do I Do This?", "Mark as Done"]);
    expect(actions.find((a) => a.id === "drop")?.destructive).toBe(true);
  });

  it("has no duplicate or reserved shortcuts", () => {
    const reserved = new Set(RESERVED_SHORTCUTS.map((s) => JSON.stringify(s)));
    for (const item of allItems(thread)) {
      const keys = journalActions(item)
        .filter((a) => a.shortcut)
        .map((a) => JSON.stringify(a.shortcut));
      expect(new Set(keys).size, item.id).toBe(keys.length);
      expect(
        keys.filter((k) => reserved.has(k)),
        item.id,
      ).toEqual([]);
    }
  });
});

describe("howMarkdown", () => {
  const how = (name: string) => fixture<JournalHow>(`journal-how-${name}.json`);

  it("lists fresh steps as one numbered list", () => {
    expect(howMarkdown(how("fresh"))).toBe("1. Step 1\n2. Step 2\n3. Step 3");
  });

  it("says pending", () => {
    expect(howMarkdown(how("pending"))).toBe("Pending — press ⌘R to read it again");
  });

  it("says failed and keeps the steps", () => {
    const text = howMarkdown(how("failed"));
    expect(text).toContain("Failed: timeout");
    expect(text).toContain("1. Step 1");
  });

  it("notes stale and keeps the steps", () => {
    const text = howMarkdown(how("stale"));
    expect(text).toContain("Out of date");
    expect(text).toContain("2. Step 2");
  });

  it("says missing", () => {
    expect(howMarkdown(how("missing"))).toBe("No checklist yet");
  });

  it("strips a leading list marker so numbering is not doubled", () => {
    expect(howMarkdown({ item: "x", state: "fresh", steps: ["1. foo", "- bar"] })).toBe("1. foo\n2. bar");
  });

  it("escapes markdown in a step", () => {
    const text = howMarkdown({ item: "x", state: "fresh", steps: ["![x](https://example.invalid/x.png) **b**"] });
    expect(text).not.toContain("![");
    expect(text).toContain("\\!\\[x\\]\\(");
  });
});

describe("navigationTitle", () => {
  it("names the checkout by its folder, not its bare name", () => {
    expect(navigationTitle({ ...thread, name: "main", folder: "fylgja-raycast/main", branch: "main" })).toBe(
      "fylgja-raycast/main · main",
    );
    expect(navigationTitle({ ...thread, name: "main", folder: "", branch: "dev" })).toBe("main · dev");
  });

  it("cuts a long name to 60 code points on one line", () => {
    const title = navigationTitle({ ...thread, name: `${"n".repeat(45)}\n${"m".repeat(45)}`, branch: "main" });
    expect(Array.from(title).length).toBeLessThanOrEqual(60);
    expect(title).not.toContain("\n");
  });

  it("joins name and branch", () => {
    expect(navigationTitle(thread)).toBe("alpha/main · main");
  });
});
