import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDetail } from "../src/detail";
import type { Items, NavItem } from "../src/fylgja/types";
import { toRow } from "../src/rows";

process.env.TZ = "Europe/Oslo";
const NOW = Date.parse("2026-10-05T12:00:00Z");
const NONE: ReadonlySet<string> = new Set();
const options = { pendingSummary: NONE, now: NOW };

function load(name: string): Items {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as Items;
}

function item(extra: Partial<NavItem> = {}): NavItem {
  return {
    id: "x1",
    key: "folder:/work/x",
    kind: "folder",
    name: "alpha/main",
    path: "/work/x",
    tickets: [],
    score: 1,
    explanation: "focus 10",
    parts: [],
    places: [],
    state: [],
    seconds_today: 0,
    summary: "",
    ...extra,
  };
}

const md = (extra: Partial<NavItem>) => buildDetail(item(extra), options).markdown;
const labels = (extra: Partial<NavItem>) => buildDetail(item(extra), options).metadata.map((m) => m.label);

describe("detail markdown", () => {
  it("shows a fresh story with its age and no marker", () => {
    const m = md({ story: { state: "fresh", text: "Sentence one.", generated_at: "2026-10-05T10:00:00Z" } });
    expect(m).toContain("Sentence one.");
    expect(m).toContain("2h ago");
    expect(m).not.toMatch(/outdated|updating|failed/);
  });

  it("marks stale, pending and failed stories", () => {
    expect(md({ story: { state: "stale", text: "Sentence one." } })).toContain("outdated");
    expect(md({ story: { state: "pending", text: "Sentence one." } })).toContain("updating…");
    expect(md({ story: { state: "failed", text: "Sentence one." } })).toContain("last attempt failed");
  });

  it("shows an unknown story state as text", () => {
    expect(md({ story: { state: "half_baked", text: "Sentence one." } })).toContain("half baked");
  });

  it("has no story heading without text or without a story", () => {
    expect(md({ story: { state: "pending" } })).not.toContain("Story");
    expect(md({})).toBe("## alpha/main");
  });

  it("shows the journal: Where you are, three next items and +N more", () => {
    const m = md({
      journal: {
        thread: "t1",
        where: "Sentence one.",
        next: [1, 2, 3, 4].map((n) => ({ id: `n${n}`, text: `Next ${n}` })),
        next_more: 2,
      },
    });
    expect(m).toContain("Where you are");
    expect(m).toContain("Next 3");
    expect(m).not.toContain("Next 4");
    expect(m).toContain("+2 more in the Journal");
  });

  it("leads with the item's name, then the journal, then the story and the summary", () => {
    const m = md({
      summary: "The summary.",
      story: { state: "fresh", text: "The story." },
      journal: { thread: "t1", where: "The where.", next: [{ id: "n1", text: "The next." }] },
    });
    const order = ["## alpha/main", "Where you are", "Do next", "The story.", "The summary."].map((s) => m.indexOf(s));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("has no Where you are heading without where, and nothing without a journal", () => {
    expect(md({ journal: { thread: "t1", next: [{ id: "n1", text: "Next 1" }] } })).not.toContain("Where you are");
    expect(md({})).not.toContain("Do next");
  });

  it("escapes daemon text", () => {
    const evil = "![x](https://example.invalid/x.png)";
    const m = md({
      summary: evil,
      story: { state: "fresh", text: evil },
      journal: { thread: "t", where: evil, next: [{ id: "n", text: evil }] },
      places: [{ kind: "window", ref: "1", role: "ide", label: "PyCharm", title: evil, open: true, waiting: false }],
    });
    expect(m).toContain("\\!\\[x\\]");
    expect(m).not.toMatch(/(^|[^\\])!\[/);
    expect(m).not.toMatch(/(^|[^\\])\]\(/);
  });
});

describe("detail metadata", () => {
  it("shows App id for an app item and Path for a folder item", () => {
    expect(labels({ kind: "app", key: "app:com.example.slack", path: undefined })).toContain("App id");
    const app = buildDetail(item({ kind: "app", key: "app:com.example.slack" }), options).metadata;
    expect(app.find((m) => m.label === "App id")!.text).toBe("com.example.slack");
    expect(app.map((m) => m.label)).not.toContain("Path");
    expect(labels({})).toContain("Path");
    expect(labels({})).not.toContain("App id");
  });

  it("renders an item whose daemon omitted summary and explanation", () => {
    const partial = item({ summary: undefined, explanation: undefined } as unknown as Partial<NavItem>);
    const detail = buildDetail(partial, options);
    expect(detail.markdown).not.toContain("## Summary");
    expect(detail.metadata.map((m) => m.label)).not.toContain("Ranker");
  });

  it("shows Group only when present", () => {
    expect(labels({})).not.toContain("Group");
    expect(labels({ group: "alpha-group" })).toContain("Group");
  });

  it("writes one line per place", () => {
    const lines = buildDetail(
      item({
        places: [
          {
            kind: "window",
            ref: "1",
            role: "ide",
            label: "PyCharm",
            title: "Window title 1",
            workspace: "3",
            open: true,
            waiting: true,
            last_focus_at: "2026-10-05T11:55:00Z",
          },
          { kind: "window", ref: "2", role: "terminal", label: "Terminal", open: false, waiting: false },
        ],
        seconds_today: 5400,
        last_focus_at: "2026-10-05T11:00:00Z",
      }),
      options,
    ).metadata;
    expect(lines).toContainEqual({ label: "PyCharm — Window title 1", text: "ws 3 · open · waiting · 5m ago" });
    expect(lines).toContainEqual({ label: "Terminal", text: "closed" });
    expect(lines).toContainEqual({ label: "Today", text: "1h 30m" });
    expect(lines).toContainEqual({ label: "Last focus", text: "1h ago" });
    expect(lines).toContainEqual({ label: "Ranker", text: "focus 10" });
  });

  it("carries every accessory text of the row, for every fixture item", () => {
    const all = [...load("items.json").items, ...load("items-edge.json").items];
    for (const it of all) {
      const detail = buildDetail(it, options);
      const haystack = detail.markdown + "\n" + detail.metadata.map((m) => `${m.label} ${m.text}`).join("\n");
      for (const accessory of toRow(it, options).accessories) {
        expect(haystack, `${it.name}: ${accessory.text}`).toContain(accessory.text);
      }
    }
  });

  it("puts the row's accessories first, as tags", () => {
    const it = item({ state: ["build_failed", "dirty"] } as Partial<NavItem>);
    const first = buildDetail(it, options).metadata[0];
    expect(first.label).toBe("Status");
    expect(first.tags).toEqual(toRow(it, options).accessories);
  });

  it("carries the summarizing accessory while a summary is pending", () => {
    const it = item({ id: "p1" });
    const detail = buildDetail(it, { pendingSummary: new Set(["p1"]), now: NOW });
    expect(detail.metadata.some((m) => m.text.includes("summarizing…"))).toBe(true);
  });
});
