/**
 * Read-only live contract check against the local Fylgja daemon (R11): GET only, counts and JSON paths only, never a
 * value. Run with `npm run test:live`; the default suite excludes this folder. Imports only pure modules (R2).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "../../src/fylgja/client";
import { FylgjaError } from "../../src/fylgja/errors";
import { createHttp } from "../../src/fylgja/http";
import { createJournalClient, type JournalClient } from "../../src/fylgja/journal-client";
import type { FocusedJournal } from "../../src/fylgja/journal-types";
import type { GoTarget, Items, NavItem, Rankers } from "../../src/fylgja/types";
import { buildDetail } from "../../src/detail";
import { iconFor, buildAppIndex } from "../../src/icons";
import { itemActions } from "../../src/item-actions";
import { journalView } from "../../src/journal/model";
import { menubarModel } from "../../src/journal/menubar-model";
import { daySections, toRow } from "../../src/rows";

const BASE = process.env.FYLGJA_LIVE_URL ?? "http://127.0.0.1:7319";
const NOW = new Date();

// ---- structural specs --------------------------------------------------------------------------------------------

type Spec =
  "string" | "number" | "boolean" | { object: Fields } | { array: Spec } | { enum: readonly string[] } | "any";
type Fields = Record<string, Spec>;
interface Shape {
  required: Fields;
  optional?: Fields;
}

const WAITING = ["permission", "input", "turn_done", "run_finished", "build_failed", "review_requested", "unread"];
const TARGET: Spec = { object: { kind: { enum: ["window", "session"] }, ref: "string" } };

const PLACE: Spec = {
  object: {
    kind: { enum: ["window", "session"] },
    ref: "string",
    role: { enum: ["agent", "ide", "terminal", "app"] },
    label: "string",
    open: "boolean",
    waiting: "boolean",
  },
};
const PLACE_OPTIONAL: Fields = { title: "string", workspace: "string", last_focus_at: "string" };

const ITEMS: Shape = {
  required: {
    schema: "string",
    generated_at: "string",
    ranker: "string",
    activity: { object: { working: "boolean", active_seconds_session: "number" } },
    while_away: {
      array: {
        object: { item: "string", name: "string", kind: { enum: WAITING }, reason: "string" },
      },
    },
    items: {
      array: {
        object: {
          id: "string",
          key: "string",
          kind: { enum: ["folder", "app"] },
          name: "string",
          tickets: { array: "string" },
          score: "number",
          explanation: "string",
          parts: { array: { object: { name: "string", value: "number" } } },
          places: { array: PLACE },
          state: {
            array: { enum: [...WAITING, "todo_next", "dirty", "pr_open"] },
          },
          seconds_today: "number",
          summary: "string",
        },
      },
    },
    days: { array: { object: { day: "string", items: { array: "string" } } } },
    summaries_enabled: "boolean",
    total: "number",
    shown: "number",
  },
  optional: { ranker_fallback: "string", last_session: "any", query: "string" },
};

const ITEM_OPTIONAL: Fields = {
  path: "string",
  group: "string",
  last_focus_at: "string",
  go: TARGET,
  go_ide: TARGET,
  go_agent: TARGET,
  go_terminal: TARGET,
  story: {
    object: { state: { enum: ["fresh", "stale", "pending", "failed", "missing"] } },
  },
  journal: { object: { thread: "string", next: { array: { object: { id: "string", text: "string" } } } } },
};

const RANKERS: Shape = {
  required: {
    schema: "string",
    default: "string",
    configured_default: "string",
    rankers: { array: "any" },
    choices: { array: { object: { name: "string", default: "boolean" } } },
    selected: "string",
    stale_choice: "boolean",
  },
};

const JOURNAL_ITEM: Spec = {
  object: {
    id: "string",
    kind: { enum: ["next", "remember", "blocked"] },
    text: "string",
    status: { enum: ["open", "done", "dropped"] },
    pinned: "boolean",
    shown: "boolean",
    source: {
      object: {
        kind: { enum: ["session", "run", "commit", "todo", "file", "thread", "person"] },
        ref: "string",
        label: "string",
      },
    },
    created_at: "string",
    has_how: "boolean",
  },
};

const JOURNAL: Shape = {
  required: {
    schema: "string",
    enabled: "boolean",
    id: "string",
    name: "string",
    folder: "string",
    branch: "string",
    repo_root: "string",
    where: { object: { state: { enum: ["pending", "failed", "fresh", "missing"] } } },
    open: {
      object: { next: { array: JOURNAL_ITEM }, remember: { array: JOURNAL_ITEM }, blocked: { array: JOURNAL_ITEM } },
    },
    done_recent: {
      array: { object: { day: "string", headlines: { array: "string" }, items: { array: JOURNAL_ITEM } } },
    },
    entries: { array: "any" },
  },
  optional: { last_at: "string", error_kind: "string", error_at: "string" },
};

/** Optional keys of nested objects, by the path of the object that holds them (`[]` marks an array element). */
const NESTED_OPTIONAL: Record<string, Fields> = {
  "$.items[]": ITEM_OPTIONAL,
  "$.items[].places[]": PLACE_OPTIONAL,
  "$.while_away[]": { since: "string", go: TARGET },
  "$.activity": { away_since: "string", away_until: "string", session_started_at: "string" },
  "$.where": { text: "string", generated_at: "string" },
  "$.open.next[]": journalItemOptional(),
  "$.open.remember[]": journalItemOptional(),
  "$.open.blocked[]": journalItemOptional(),
  "$.done_recent[]": { relative: "string" },
  "$.done_recent[].items[]": journalItemOptional(),
};

function journalItemOptional(): Fields {
  return { closed_at: "string", closed_by: "string", todo_id: "string" };
}

const unknownValues = new Map<string, number>();

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function checkSpec(value: unknown, spec: Spec, path: string, problems: string[]): void {
  if (spec === "any") return;
  if (typeof spec === "string") {
    if (jsonType(value) !== spec) problems.push(`${path}: expected ${spec}, got ${jsonType(value)}`);
    return;
  }
  if ("enum" in spec) {
    if (typeof value !== "string") problems.push(`${path}: expected string, got ${jsonType(value)}`);
    else if (!spec.enum.includes(value)) unknownValues.set(path, (unknownValues.get(path) ?? 0) + 1);
    return;
  }
  if ("array" in spec) {
    if (!Array.isArray(value)) {
      problems.push(`${path}: expected array, got ${jsonType(value)}`);
      return;
    }
    for (const element of value) checkSpec(element, spec.array, `${path}[]`, problems);
    return;
  }
  if (jsonType(value) !== "object") {
    problems.push(`${path}: expected object, got ${jsonType(value)}`);
    return;
  }
  checkFields(value as Record<string, unknown>, spec.object, undefined, path, problems);
}

function checkFields(
  obj: Record<string, unknown>,
  required: Fields,
  optional: Fields | undefined,
  path: string,
  problems: string[],
): void {
  for (const [key, spec] of Object.entries(required)) {
    if (!(key in obj)) problems.push(`${path}.${key}: missing`);
    else checkSpec(obj[key], spec, `${path}.${key}`, problems);
  }
  const extra = { ...(NESTED_OPTIONAL[path] ?? {}), ...(optional ?? {}) };
  for (const [key, spec] of Object.entries(extra)) {
    if (key in obj) checkSpec(obj[key], spec, `${path}.${key}`, problems);
  }
}

function findNulls(value: unknown, path: string, problems: string[]): void {
  if (value === null) problems.push(`${path}: null`);
  else if (Array.isArray(value)) for (const element of value) findNulls(element, `${path}[]`, problems);
  else if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>))
      findNulls(child, `${path}.${key}`, problems);
  }
}

/** Structural problems of one answer: JSON paths and type names only. */
function structure(answer: unknown, shape: Shape): string[] {
  const problems: string[] = [];
  if (jsonType(answer) !== "object") return ["$: expected object"];
  findNulls(answer, "$", problems);
  checkFields(answer as Record<string, unknown>, shape.required, shape.optional, "$", problems);
  return [...new Set(problems)];
}

function targetProblems(item: NavItem): string[] {
  const problems: string[] = [];
  const targets: [string, GoTarget | undefined][] = [
    ["go", item.go],
    ["go_ide", item.go_ide],
    ["go_agent", item.go_agent],
    ["go_terminal", item.go_terminal],
  ];
  for (const [name, target] of targets) {
    if (!target) continue;
    if (!item.places.some((p) => p.kind === target.kind && p.ref === target.ref)) {
      problems.push(`$.items[].${name}: target not in places`);
    }
  }
  return problems;
}

// ---- the check ---------------------------------------------------------------------------------------------------

let client: Client;
let journalClient: JournalClient;

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/health`, { redirect: "error", signal: AbortSignal.timeout(3_000) });
    await res.arrayBuffer();
  } catch {
    throw new Error("daemon not reachable");
  }
  const http = createHttp({
    baseUrl: BASE,
    secretFile: undefined,
    fetch: (url, init) => fetch(url, init),
    // GET never reads the secret (R5); a read here would be a bug.
    readFile: () => Promise.reject(new Error("the live suite never reads a secret")),
    homedir: () => "/",
  });
  client = createClient(http);
  journalClient = createJournalClient(http);
});

function describeItems(label: string, answer: Items): string[] {
  const problems = structure(answer, ITEMS).map((p) => `${label} ${p}`);
  const appIndex = buildAppIndex([]);
  let thrown = 0;
  for (const item of answer.items) {
    problems.push(...targetProblems(item).map((p) => `${label} ${p}`));
    try {
      toRow(item, { pendingSummary: new Set(), now: NOW });
      buildDetail(item, { pendingSummary: new Set(), now: NOW });
      itemActions(item, answer.summaries_enabled);
      iconFor(item, appIndex);
    } catch {
      thrown += 1;
    }
  }
  if (thrown > 0)
    problems.push(`${label} $.items[]: ${thrown} item(s) threw in the row, detail, action or icon builder`);
  const days = daySections(answer, NOW);
  if ("error" in days) problems.push(`${label} $.days: contract error`);
  console.log(
    `${label}: ${answer.items.length} items, ${answer.days.length} days, total ${answer.total}, shown ${answer.shown}`,
  );
  return problems;
}

describe("live contract", () => {
  it("passes on /rankers, /items and /journal/focused", async () => {
    const problems: string[] = [];

    const rankers: Rankers = await client.getRankers();
    problems.push(...structure(rankers, RANKERS).map((p) => `rankers ${p}`));
    console.log(`rankers: ${rankers.choices.length} choices, ${rankers.rankers.length} rankers`);

    const requests: [string, Parameters<Client["getItems"]>[0]][] = [
      ["items", {}],
      ["items open=true", { open: true }],
      ["items q=a", { q: "a" }],
      ...rankers.choices.map((c, i): [string, Parameters<Client["getItems"]>[0]] => [
        `items rank#${i}`,
        { rank: c.name },
      ]),
    ];
    for (const [label, query] of requests) {
      try {
        problems.push(...describeItems(label, await client.getItems(query)));
      } catch (err) {
        problems.push(`${label}: ${err instanceof FylgjaError ? `error kind ${err.kind}` : "unexpected error"}`);
      }
    }

    let journal: FocusedJournal | undefined;
    try {
      journal = await journalClient.getFocusedJournal();
    } catch (err) {
      problems.push(`journal: ${err instanceof FylgjaError ? `error kind ${err.kind}` : "unexpected error"}`);
    }
    if (journal) {
      if (journal.kind === "thread") {
        problems.push(...structure(journal.thread, JOURNAL).map((p) => `journal ${p}`));
        try {
          journalView(journal.thread, NOW);
        } catch {
          problems.push("journal: journalView threw");
        }
      }
      try {
        menubarModel(journal);
      } catch {
        problems.push("journal: menubarModel threw");
      }
      console.log(`journal: kind ${journal.kind}`);
    }

    if (unknownValues.size > 0) {
      for (const [path, count] of unknownValues) console.log(`unknown value at ${path} (${count}x)`);
    }
    expect(problems).toEqual([]);
  });
});
