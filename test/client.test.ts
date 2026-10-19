import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createClient } from "../src/fylgja/client";
import { FylgjaError } from "../src/fylgja/errors";
import { createHttp } from "../src/fylgja/http";

const BASE = "http://127.0.0.1:7319";
const FIXTURES = join(__dirname, "fixtures");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function json(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

/** A client over a fake `fetch` that answers every call with `answer` and records the calls. */
function setup(answer: (url: string, init: RequestInit) => Response = () => json(200, fixture("items.json"))) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: new URL(url), init });
    return answer(url, init);
  });
  const http = createHttp({
    baseUrl: BASE,
    secretFile: "/s/api-secret",
    fetch,
    readFile: async () => "abc\n",
    homedir: () => "/home/x",
  });
  return { client: createClient(http), fetch, calls };
}

async function failure(promise: Promise<unknown>): Promise<FylgjaError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(FylgjaError);
    return err as FylgjaError;
  }
  throw new Error("expected a FylgjaError");
}

describe("getItems", () => {
  it("sends rank, days and open", async () => {
    const { client, calls } = setup();
    await client.getItems({ open: true, days: 7, rank: "recent" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe("/items");
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ rank: "recent", days: "7", open: "true" });
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("omits empty and false parameters", async () => {
    const { client, calls } = setup();
    await client.getItems({ open: false, rank: "", q: "   " });
    expect(calls[0]!.url.search).toBe("");
  });

  it("trims q", async () => {
    const { client, calls } = setup();
    await client.getItems({ q: "  foo  " });
    expect(calls[0]!.url.searchParams.get("q")).toBe("foo");
  });

  it("cuts q to 200 code points without splitting a pair", async () => {
    const { client, calls } = setup();
    await client.getItems({ q: "a".repeat(201) });
    await client.getItems({ q: "a".repeat(199) + "😀" });
    await client.getItems({ q: "a".repeat(200) + "😀" });
    expect(calls[0]!.url.searchParams.get("q")).toBe("a".repeat(200));
    expect(calls[1]!.url.searchParams.get("q")).toBe("a".repeat(199) + "😀");
    expect(calls[2]!.url.searchParams.get("q")).toBe("a".repeat(200));
  });

  it("does not throw on a lone surrogate", async () => {
    const { client } = setup();
    await expect(client.getItems({ q: "\ud83d" })).resolves.toBeDefined();
  });

  it.each(["a+b", "a&b=c", "100%", "#tag", "æøå", "😀"])("round-trips q %s", async (q) => {
    const { client, calls } = setup();
    await client.getItems({ q });
    expect(calls[0]!.url.searchParams.get("q")).toBe(q);
    expect([...calls[0]!.url.searchParams.keys()]).toEqual(["q"]);
  });

  it("maps a wrong schema to a schema error with seen", async () => {
    const { client } = setup(() => json(200, '{"schema":"fylgja.items/2"}'));
    const err = await failure(client.getItems({}));
    expect(err.kind).toBe("schema");
    expect(err.seen).toBe("fylgja.items/2");
    expect(err.message).toContain("fylgja.items/2");
  });

  it("maps a missing schema to a schema error without seen", async () => {
    const { client } = setup(() => json(200, '{"items":[]}'));
    const err = await failure(client.getItems({}));
    expect(err.kind).toBe("schema");
    expect(err.seen).toBeUndefined();
    expect(err.message).toContain("no schema");
  });

  it.each(["items", "days", "while_away"])("maps a missing %s list to a schema error", async (name) => {
    const body = JSON.parse(fixture("items-empty.json")) as Record<string, unknown>;
    delete body[name];
    const { client } = setup(() => json(200, JSON.stringify(body)));
    expect((await failure(client.getItems({}))).kind).toBe("schema");
  });
});

describe("getRankers", () => {
  it("sends no rank when it is empty", async () => {
    const { client, calls } = setup(() => json(200, fixture("rankers.json")));
    await client.getRankers("");
    await client.getRankers();
    expect(calls.map((c) => c.url.pathname + c.url.search)).toEqual(["/rankers", "/rankers"]);
  });

  it("sends rank when given", async () => {
    const { client, calls } = setup(() => json(200, fixture("rankers.json")));
    await client.getRankers("recent");
    expect(calls[0]!.url.pathname + calls[0]!.url.search).toBe("/rankers?rank=recent");
  });

  it("checks the schema and the choices list", async () => {
    const wrong = setup(() => json(200, '{"schema":"fylgja.rankers/2"}'));
    expect((await failure(wrong.client.getRankers())).seen).toBe("fylgja.rankers/2");
    const noChoices = setup(() => json(200, '{"schema":"fylgja.rankers/1"}'));
    expect((await failure(noChoices.client.getRankers())).kind).toBe("schema");
  });
});

describe("focus", () => {
  it("posts to one encoded path segment", async () => {
    const { client, calls } = setup(() => json(200, '{"focused":"window","via":"aerospace"}'));
    const result = await client.focus({ kind: "session", ref: "claude:abc@x" });
    expect(result).toEqual({ focused: "window", via: "aerospace" });
    expect(calls[0]!.url.pathname).toBe("/focus/session/claude%3Aabc%40x");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBe("{}");
  });

  it.each(["a/b", "a?b", "a#b", "a%b", "a b", "a%2Fb"])("keeps %s in one segment", async (ref) => {
    const { client, calls } = setup(() => json(200, '{"focused":"window","via":"x"}'));
    await client.focus({ kind: "window", ref });
    const rest = calls[0]!.url.pathname.slice("/focus/window/".length);
    expect(rest).not.toContain("/");
    expect(calls[0]!.url.search).toBe("");
    expect(decodeURIComponent(rest)).toBe(ref);
  });

  it("refuses a bad target before any request", async () => {
    const { client, fetch } = setup();
    const tab = await failure(client.focus({ kind: "tab", ref: "1" } as never));
    expect(tab.kind).toBe("bad_request");
    const empty = await failure(client.focus({ kind: "window", ref: "" }));
    expect(empty.kind).toBe("bad_request");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps 404 to the window and session messages", async () => {
    const { client } = setup(() => json(404, '{"detail":"no such thing"}'));
    const window = await failure(client.focus({ kind: "window", ref: "1" }));
    expect(window.kind).toBe("not_found");
    expect(window.message).toBe("That window is gone");
    const session = await failure(client.focus({ kind: "session", ref: "x" }));
    expect(session.message).toBe("That session has ended");
  });

  it("leaves other errors alone", async () => {
    const { client } = setup(() => json(409, '{"detail":"session has no window"}'));
    const err = await failure(client.focus({ kind: "session", ref: "x" }));
    expect(err.kind).toBe("conflict");
    expect(err.message).toBe("session has no window");
  });
});

describe("summaries", () => {
  it("summarize posts an empty object and reports a pending job", async () => {
    const { client, calls } = setup(() => json(202, '{"state":"pending"}'));
    expect(await client.summarize("abc")).toEqual({ status: 202, state: "pending" });
    expect(calls[0]!.url.pathname).toBe("/summaries/folder/abc");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBe("{}");
  });

  it("summarize reports a 200 answer's state", async () => {
    const { client } = setup(() => json(200, '{"state":"stale"}'));
    expect(await client.summarize("abc")).toEqual({ status: 200, state: "stale" });
  });

  it("summarize maps 409 disabled to summaries_off", async () => {
    const { client } = setup(() => json(409, '{"scope":"folder","ref":"abc","state":"disabled"}'));
    expect((await failure(client.summarize("abc"))).kind).toBe("summaries_off");
  });

  it.each(["fresh", "stale", "pending", "missing", "failed", "disabled"])("getSummary reads %s", async (state) => {
    const { client, calls } = setup(() => json(200, fixture(`summary-${state}.json`)));
    const result = await client.getSummary("0000000000000a01");
    expect(result.state).toBe(state);
    expect(calls[0]!.url.pathname).toBe("/summaries/folder/0000000000000a01");
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("getSummary keeps the failed error_kind", async () => {
    const { client } = setup(() => json(200, fixture("summary-failed.json")));
    expect((await client.getSummary("x")).error_kind).toBe("timeout");
  });
});

describe("fixtures", () => {
  const files = readdirSync(FIXTURES).filter((name) => name.endsWith(".json"));

  it.each(files.filter((name) => name.startsWith("items")))("%s parses through getItems", async (name) => {
    const { client } = setup(() => json(200, fixture(name)));
    const items = await client.getItems({});
    expect(items.schema).toBe("fylgja.items/1");
  });

  it.each(files.filter((name) => name.startsWith("rankers")))("%s parses through getRankers", async (name) => {
    const { client } = setup(() => json(200, fixture(name)));
    const rankers = await client.getRankers();
    expect(rankers.schema).toBe("fylgja.rankers/1");
  });

  it.each(files.filter((name) => name.startsWith("items")))("%s: days hold each item exactly once", (name) => {
    const body = JSON.parse(fixture(name)) as { items: { id: string }[]; days: { items: string[] }[] };
    const ids = body.items.map((item) => item.id);
    expect(body.days.flatMap((day) => day.items).sort()).toEqual([...ids].sort());
    // Each day keeps rank order.
    for (const day of body.days) {
      expect(day.items).toEqual(ids.filter((id) => day.items.includes(id)));
    }
    const dayNames = body.days.map((day) => (day as unknown as { day: string }).day);
    expect(dayNames).toEqual([...dayNames].sort().reverse());
  });
});
