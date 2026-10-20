import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FylgjaError } from "../src/fylgja/errors";
import type { AwayChange, Items, NavItem } from "../src/fylgja/types";
import {
  awayRows,
  navigationTitle,
  sections,
  showAwaySection,
  toRow,
  viewState,
  type ViewStateInput,
} from "../src/rows";

process.env.TZ = "Europe/Oslo";
const NOW = Date.parse("2026-10-05T12:00:00Z");
const NONE: ReadonlySet<string> = new Set();

function load(name: string): Items {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as Items;
}

const items = load("items.json");
const edge = load("items-edge.json");

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
    places: [{ kind: "window", ref: "100", role: "ide", label: "PyCharm", open: true, waiting: false }],
    state: [],
    seconds_today: 0,
    summary: "",
    go: { kind: "window", ref: "100" },
    ...extra,
  };
}

const row = (extra: Partial<NavItem> = {}) => toRow(item(extra), { pendingSummary: NONE, now: NOW });
const texts = (extra: Partial<NavItem>) => row(extra).accessories.map((a) => a.text);

describe("toRow", () => {
  it("keeps ids; ids are unique across items and away rows", () => {
    const ids: string[] = [];
    for (const answer of [items, edge]) {
      for (const it of answer.items) {
        const r = toRow(it, { pendingSummary: NONE, now: NOW });
        expect(r.id).toBe(it.id);
        ids.push(r.id);
      }
      ids.push(...awayRows(answer.while_away, NOW).map((r) => r.id));
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the summary, then the go place's title, then nothing", () => {
    expect(row({ summary: "CBS-1 · main · dirty" }).subtitle).toBe("CBS-1 · main · dirty");
    const titled = [
      {
        kind: "window" as const,
        ref: "100",
        role: "ide",
        label: "PyCharm",
        title: "Window title\n1",
        open: true,
        waiting: false,
      },
    ];
    expect(row({ places: titled }).subtitle).toBe("Window title 1");
    expect(row().subtitle).toBe("");
    expect(row({ go: undefined, places: titled }).subtitle).toBe("");
  });

  it("cuts the subtitle at 100 code points", () => {
    const sub = row({ summary: "😀".repeat(150) }).subtitle;
    expect(Array.from(sub)).toHaveLength(100);
    expect(sub.endsWith("…")).toBe(true);
  });

  it("shows one waiting marker, the most urgent", () => {
    const r = row({ state: ["permission", "input"] });
    expect(r.accessories).toHaveLength(1);
    expect(r.accessories[0]).toMatchObject({ text: "needs approval", tone: "urgent", source: "agent" });
    expect(r.accessories[0]!.tooltip).toBe("Waiting: needs approval, needs answer");
    expect(row({ state: ["unread", "turn_done"] }).accessories[0]).toMatchObject({
      text: "done",
      tone: "warning",
    });
    expect(texts({ state: ["build_failed"] })).toEqual(["build failed"]);
    expect(texts({ state: ["turn_done", "dirty", "pr_open"] })).toEqual(["done", "dirty", "PR open"]);
    expect(texts({ state: ["todo_next"] })).toEqual(["todo next"]);
  });

  it("gives each known state its source", () => {
    const source = (state: string) => row({ state: [state] }).accessories[0]!.source;
    expect(["permission", "input", "turn_done"].map(source)).toEqual(["agent", "agent", "agent"]);
    expect(["run_finished", "build_failed", "review_requested", "unread"].map(source)).toEqual([
      "run",
      "ci",
      "review",
      "unread",
    ]);
    expect(["dirty", "pr_open", "todo_next"].map(source)).toEqual(["git", "pr", "todo"]);
  });

  it("gives tickets, time, workspace and unknown states no source", () => {
    const r = row({ state: ["frobnicate", "constructor"], tickets: ["CBS-1"], seconds_today: 60 });
    expect(r.accessories.map((a) => a.text)).toEqual(["CBS-1", "frobnicate", "constructor", "1m today"]);
    expect(r.accessories.every((a) => a.source === undefined)).toBe(true);
  });

  it("renders an unknown state as a neutral tag and none for []", () => {
    expect(row({ state: ["frobnicate"] }).accessories[0]).toMatchObject({ text: "frobnicate", tone: "neutral" });
    expect(row({ state: ["a_b"] }).accessories[0]!.text).toBe("a b");
    expect(texts({ state: [] })).toEqual([]);
  });

  it("shows time, workspace and nothing open", () => {
    expect(texts({ seconds_today: 3249 })).toEqual(["54m today"]);
    expect(texts({ last_focus_at: "2026-10-05T10:00:00Z" })).toEqual(["2h ago"]);
    expect(texts({ go: undefined })).toEqual(["nothing open"]);
    const ws = [
      { kind: "window" as const, ref: "100", role: "ide", label: "P", workspace: "3", open: true, waiting: false },
    ];
    expect(texts({ places: ws })).toEqual(["ws 3"]);
    expect(texts({ places: ws, go: undefined })).toEqual(["nothing open"]);
  });

  it("shows tickets as a tag", () => {
    expect(texts({ tickets: [] })).toEqual([]);
    expect(texts({ tickets: ["CBS-1"] })).toEqual(["CBS-1"]);
    expect(texts({ tickets: ["CBS-1", "CBS-2", "CBS-3", "CBS-4"] })).toEqual(["CBS-1 +3"]);
  });

  it("puts the pending marker first", () => {
    const r = toRow(item({ tickets: ["CBS-1"] }), { pendingSummary: new Set(["x1"]), now: NOW });
    expect(r.accessories).toHaveLength(2);
    expect(r.accessories[1]!.text).toBe("CBS-1");
  });

  it("does not dedupe items with the same name", () => {
    const rows = [item({ id: "a" }), item({ id: "b" })].map((i) => toRow(i, { pendingSummary: NONE, now: NOW }));
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    const names = edge.items.filter((i) => i.name === "PyCharm");
    expect(names).toHaveLength(2);
  });
});

describe("awayRows", () => {
  const entry: AwayChange = {
    item: "i1",
    name: "alpha/main",
    kind: "turn_done",
    reason: "Sentence one.",
    since: "2026-10-05T11:00:00Z",
    go: { kind: "session", ref: "claude:abc" },
  };

  it("renders title, reason, kind and age", () => {
    const [r] = awayRows([entry], NOW);
    expect(r).toMatchObject({
      id: "away:i1:turn_done:0",
      title: "alpha/main",
      subtitle: "Sentence one.",
      go: entry.go,
    });
    expect(r!.accessories.map((a) => a.text)).toEqual(["done", "1h ago"]);
    expect(r!.accessories[0]!.source).toBe("agent");
  });

  it("has no time without since and unique ids for one item", () => {
    const noSince: AwayChange = { ...entry, since: undefined };
    const rows = awayRows([noSince, entry], NOW);
    expect(rows[0]!.accessories.map((a) => a.text)).toEqual(["done"]);
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
  });
});

describe("viewState", () => {
  const answer = (shown: number, total: number): Items => ({ ...items, shown, total });
  const input = (extra: Partial<ViewStateInput>): ViewStateInput => ({
    loading: false,
    data: undefined,
    error: undefined,
    q: "",
    onlyOpen: false,
    ...extra,
  });

  it("is loading or searching without data", () => {
    expect(viewState(input({ loading: true }))).toEqual({ kind: "loading" });
    expect(viewState(input({ loading: true, q: "foo" }))).toEqual({ kind: "searching", title: "Searching…" });
    expect(viewState(input({ loading: true, q: "   " })).kind).toBe("loading");
  });

  it("lets an error win over data, except an abort", () => {
    const error = new FylgjaError("daemon_down", "The Fylgja daemon is not running on 127.0.0.1:7319");
    expect(viewState(input({ data: items, error }))).toEqual({ kind: "error", title: error.message });
    expect(viewState(input({ error })).kind).toBe("error");
    expect(viewState(input({ data: items, error: new FylgjaError("aborted", "x") })).kind).toBe("list");
  });

  it("is a list when something is shown", () => {
    expect(viewState(input({ data: answer(35, 68), onlyOpen: true }))).toEqual({ kind: "list" });
  });

  it("explains an empty search", () => {
    expect(viewState(input({ data: answer(0, 68), q: "foo", onlyOpen: true }))).toEqual({
      kind: "empty-no-match",
      title: "No open items match",
      offerPreferences: true,
    });
    expect(viewState(input({ data: answer(0, 68), q: "foo" }))).toEqual({
      kind: "empty-no-match",
      title: "No items match",
    });
  });

  it("explains an empty list without a search", () => {
    expect(viewState(input({ data: answer(0, 68), onlyOpen: true }))).toEqual({
      kind: "empty-nothing-open",
      title: "Nothing is open",
      offerPreferences: true,
    });
    expect(viewState(input({ data: answer(0, 68) })).kind).toBe("empty-nothing-recorded");
  });

  it("puts a search before 'nothing recorded' on an empty daemon", () => {
    for (const onlyOpen of [true, false]) {
      const s = viewState(input({ data: answer(0, 0), q: "foo", onlyOpen }));
      expect(s).toEqual({ kind: "empty-no-match", title: onlyOpen ? "No open items match" : "No items match" });
      const r = viewState(input({ data: answer(0, 0), onlyOpen }));
      expect(r).toEqual({ kind: "empty-nothing-recorded", title: "Nothing recorded yet" });
      expect(viewState(input({ data: answer(0, 0), q: "   ", onlyOpen }))).toEqual(r);
    }
  });
});

describe("navigationTitle", () => {
  const answer = { ...items, shown: 35, total: 68, ranker: "frecency", ranker_fallback: undefined };

  it("shows counts and ranker", () => {
    expect(navigationTitle(answer, { onlyOpen: false })).toBe("35 of 68 · frecency");
    expect(navigationTitle({ ...answer, ranker_fallback: "frecency" }, { onlyOpen: false })).toBe(
      "35 of 68 · frecency · fallback",
    );
    expect(navigationTitle(answer, { onlyOpen: true })).toBe("35 of 68 · frecency · open only");
    expect(navigationTitle({ ...answer, shown: 0, total: 0 }, { onlyOpen: false })).toBe("0 of 0 · frecency");
  });
});

describe("showAwaySection", () => {
  it("hides during a search and when empty", () => {
    const away = { ...items, while_away: [{ item: "i", name: "n", kind: "input", reason: "r" }] };
    expect(showAwaySection(away, "x")).toBe(false);
    expect(showAwaySection(away, "  ")).toBe(true);
    expect(showAwaySection(away, "")).toBe(true);
    expect(showAwaySection({ ...away, while_away: [] }, "")).toBe(false);
  });
});

describe("sections", () => {
  it("shows the away section only without a search", () => {
    expect(sections(edge, "")).toEqual(["away", "items"]);
    expect(sections(edge, "x")).toEqual(["items"]);
  });

  it("leaves the away section out when nothing changed", () => {
    expect(sections({ ...edge, while_away: [] }, "")).toEqual(["items"]);
  });
});
