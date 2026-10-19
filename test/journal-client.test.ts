import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FylgjaError } from "../src/fylgja/errors";
import { createHttp } from "../src/fylgja/http";
import { createJournalClient } from "../src/fylgja/journal-client";

const BASE = "http://127.0.0.1:7319";
const FIXTURES = join(__dirname, "fixtures");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function json(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function detail(status: number, text: string): Response {
  return json(status, JSON.stringify({ detail: text }));
}

function setup(answer: (url: string, init: RequestInit) => Response) {
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
  return { client: createJournalClient(http), fetch, calls };
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

describe("getFocusedJournal", () => {
  it("returns the thread on 200", async () => {
    const { client, calls } = setup(() => json(200, fixture("journal-thread.json")));
    const result = await client.getFocusedJournal();
    expect(result.kind).toBe("thread");
    if (result.kind !== "thread") return;
    expect(result.thread.open.next).toHaveLength(4);
    expect(result.thread.done_recent).toHaveLength(3);
    expect(calls[0]!.url.pathname).toBe("/journal/focused");
    expect(calls[0]!.init.method).toBe("GET");
    expect(new Headers(calls[0]!.init.headers).has("Authorization")).toBe(false);
  });

  it.each(["journal-empty.json", "journal-where-only.json"])("%s is a thread with empty sections", async (name) => {
    const { client } = setup(() => json(200, fixture(name)));
    const result = await client.getFocusedJournal();
    expect(result.kind).toBe("thread");
    if (result.kind !== "thread") return;
    expect(result.thread.open).toEqual({ next: [], remember: [], blocked: [] });
    expect(result.thread.done_recent).toEqual([]);
  });

  it.each(["nothing is focused", "no journal for this checkout"])("maps 404 %s to empty", async (text) => {
    const { client } = setup(() => detail(404, text));
    await expect(client.getFocusedJournal()).resolves.toEqual({ kind: "empty", detail: text });
  });

  it("keeps 404 Not Found as route_missing", async () => {
    const { client } = setup(() => detail(404, "Not Found"));
    expect((await failure(client.getFocusedJournal())).kind).toBe("route_missing");
  });

  it("keeps another 404 detail as not_found", async () => {
    const { client } = setup(() => detail(404, "something else"));
    expect((await failure(client.getFocusedJournal())).kind).toBe("not_found");
  });

  it("maps 409 to off", async () => {
    const { client } = setup(() => detail(409, "the journal is off"));
    await expect(client.getFocusedJournal()).resolves.toEqual({ kind: "off" });
  });

  it("rejects another schema", async () => {
    const body = JSON.stringify({ ...JSON.parse(fixture("journal-empty.json")), schema: "fylgja.journal/2" });
    const { client } = setup(() => json(200, body));
    const err = await failure(client.getFocusedJournal());
    expect(err.kind).toBe("schema");
    expect(err.seen).toBe("fylgja.journal/2");
  });

  it("rejects a missing schema", async () => {
    const { client } = setup(() => json(200, "{}"));
    const err = await failure(client.getFocusedJournal());
    expect(err.kind).toBe("schema");
    expect(err.message).toContain("no schema");
  });
});

describe("patchItem", () => {
  it("sends only status", async () => {
    const { client, calls } = setup(() => json(200, "{}"));
    await client.patchItem("a1", { status: "done" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(calls[0]!.url.pathname).toBe("/journal/items/a1");
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer abc");
    expect(calls[0]!.init.body).toBe('{"status":"done"}');
  });

  it("sends pinned false", async () => {
    const { client, calls } = setup(() => json(200, "{}"));
    await client.patchItem("a1", { pinned: false });
    expect(calls[0]!.init.body).toBe('{"pinned":false}');
  });

  it("encodes the id", async () => {
    const { client, calls } = setup(() => json(200, "{}"));
    await client.patchItem("a/b c", { pinned: true });
    expect(calls[0]!.url.pathname).toBe("/journal/items/a%2Fb%20c");
  });

  it.each([
    ["an empty patch", {}],
    ["an undefined value", { pinned: undefined }],
    ["a null value", { status: null }],
    ["an unknown key", { text: "x" }],
  ])("refuses %s before any request", async (_what, patch) => {
    const { client, fetch } = setup(() => json(200, "{}"));
    const err = await failure(client.patchItem("a1", patch as never));
    expect(err.kind).toBe("bad_request");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [404, "journal item not found", "not_found"],
    [422, "invalid body (check: status)", "unprocessable"],
    [401, "unauthorized", "unauthorized"],
  ])("maps %i to %s", async (status, text, kind) => {
    const { client } = setup(() => detail(status, text));
    expect((await failure(client.patchItem("a1", { status: "done" }))).kind).toBe(kind);
  });
});

describe("makeTodo", () => {
  it("reports created on 201", async () => {
    const { client, calls } = setup(() => json(201, "{}"));
    await expect(client.makeTodo("a1")).resolves.toEqual({ created: true });
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.url.pathname).toBe("/journal/items/a1/todo");
    expect(calls[0]!.init.body).toBe("{}");
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer abc");
  });

  it("reports an existing todo on 200", async () => {
    const { client } = setup(() => json(200, "{}"));
    await expect(client.makeTodo("a1")).resolves.toEqual({ created: false });
  });

  it.each([
    [404, "journal item not found", "not_found"],
    [409, "the journal is off", "journal_off"],
  ])("maps %i to %s", async (status, text, kind) => {
    const { client } = setup(() => detail(status, text));
    expect((await failure(client.makeTodo("a1"))).kind).toBe(kind);
  });
});

describe("How", () => {
  it("requestHow keeps a fresh answer with steps", async () => {
    const { client, calls } = setup(() => json(200, fixture("journal-how-fresh.json")));
    const how = await client.requestHow("n1");
    expect(how.state).toBe("fresh");
    expect(how.steps).toEqual(["Step 1", "Step 2", "Step 3"]);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.url.pathname).toBe("/journal/items/n1/how");
    expect(calls[0]!.init.body).toBe("{}");
  });

  it("requestHow keeps a pending answer", async () => {
    const { client } = setup(() => json(202, fixture("journal-how-pending.json")));
    const how = await client.requestHow("n1");
    expect(how.state).toBe("pending");
    expect(how.steps).toBeUndefined();
  });

  it.each([
    ["journal-how-fresh.json", "fresh", 3],
    ["journal-how-stale.json", "stale", 2],
    ["journal-how-pending.json", "pending", undefined],
    ["journal-how-failed.json", "failed", 1],
    ["journal-how-missing.json", "missing", undefined],
  ])("getHow reads %s", async (name, state, steps) => {
    const { client, calls } = setup(() => json(200, fixture(name)));
    const how = await client.getHow("n1");
    expect(how.item).toBe("n1");
    expect(how.state).toBe(state);
    expect(how.steps?.length).toBe(steps);
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.url.pathname).toBe("/journal/items/n1/how");
  });

  it("getHow keeps error_kind of a failed answer", async () => {
    const { client } = setup(() => json(200, fixture("journal-how-failed.json")));
    expect((await client.getHow("n1")).error_kind).toBe("timeout");
  });

  it("handles steps absent and empty", async () => {
    const empty = setup(() => json(200, '{"item":"n1","state":"fresh","steps":[]}'));
    expect((await empty.client.getHow("n1")).steps).toEqual([]);
    const absent = setup(() => json(200, '{"item":"n1","state":"missing"}'));
    expect((await absent.client.getHow("n1")).steps).toBeUndefined();
  });
});
