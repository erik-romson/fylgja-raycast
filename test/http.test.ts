import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanDetail, FylgjaError, type FylgjaErrorKind } from "../src/fylgja/errors";
import { createHttp, type RequestOptions } from "../src/fylgja/http";

const BASE = "http://127.0.0.1:7319";
const SECRET_PATH = "/s/api-secret";
const SAFE_SECRET = "S3CR3T";

type Answer = (url: string, init: RequestInit) => Promise<Response> | Response;

function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: "ENOENT" });
}

/** An `http` over a fake `fetch` that records its calls and a fake secret file (`null` = missing). */
function setup(answer: Answer, options: { secret?: string | null; baseUrl?: string } = {}) {
  const state = { secret: options.secret === undefined ? "abc" : options.secret };
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer(url, init);
  });
  const readFile = vi.fn(async (path: string) => {
    if (path !== SECRET_PATH || state.secret === null) throw enoent(path);
    return state.secret;
  });
  const http = createHttp({
    baseUrl: options.baseUrl ?? BASE,
    secretFile: SECRET_PATH,
    fetch,
    readFile,
    homedir: () => "/home/x",
  });
  return { http, fetch, readFile, calls, state };
}

function respond(status: number, body: string, type = "application/json"): Answer {
  return () => new Response(status === 204 ? null : body, { status, headers: { "content-type": type } });
}

const json = (value: unknown) => JSON.stringify(value);
const never = (): Promise<Response> => new Promise<Response>(() => undefined);
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

function headerValues(init: RequestInit, name: string): string[] {
  return Object.entries(init.headers as Record<string, string>)
    .filter(([key]) => key.toLowerCase() === name)
    .map(([, value]) => value);
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET", () => {
  it("omits empty, whitespace-only, false and undefined parameters and sends no secret", async () => {
    const { http, calls, readFile } = setup(respond(200, json({ schema: "x" })));
    const answer = await http.get("/items", { rank: "", q: "  ", open: false, days: undefined });
    expect(answer).toEqual({ status: 200, json: { schema: "x" } });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(`${BASE}/items`);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.body).toBeUndefined();
    expect(headerValues(init, "accept")).toEqual(["application/json"]);
    expect(headerValues(init, "authorization")).toEqual([]);
    expect(headerValues(init, "content-type")).toEqual([]);
    expect(headerValues(init, "origin")).toEqual([]);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("sends the parameters that carry a value", async () => {
    const { http, calls } = setup(respond(200, json({})));
    await http.get("/items", { rank: "recent", days: 7, open: true, q: "a b" });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/items");
    expect(Object.fromEntries(url.searchParams)).toEqual({ rank: "recent", days: "7", open: "true", q: "a b" });
  });

  it("refuses a bad base URL before any request", async () => {
    const { http, fetch, readFile } = setup(respond(200, json({})), { baseUrl: "http://evil.example:7319" });
    expect((await failure(http.get("/items"))).kind).toBe("bad_base_url");
    expect(fetch).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("uses the default address for an empty preference and rewrites localhost", async () => {
    const empty = setup(respond(200, json({})), { baseUrl: "" });
    await empty.http.get("/items");
    expect(empty.calls[0].url).toBe(`${BASE}/items`);
    const local = setup(respond(200, json({})), { baseUrl: "http://localhost:8123/" });
    await local.http.get("/rankers");
    expect(local.calls[0].url).toBe("http://127.0.0.1:8123/rankers");
  });
});

describe("POST and PATCH", () => {
  it("sends exactly one bearer, one JSON content type, no Origin and the body {}", async () => {
    const { http, calls, readFile } = setup(respond(200, json({ focused: "window", via: "aerospace" })));
    const answer = await http.send("POST", "/focus/window/100");
    expect(answer).toEqual({ status: 200, json: { focused: "window", via: "aerospace" } });
    const { url, init } = calls[0];
    expect(url).toBe(`${BASE}/focus/window/100`);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.body).toBe("{}");
    expect(headerValues(init, "authorization")).toEqual(["Bearer abc"]);
    expect(headerValues(init, "content-type")).toEqual(["application/json"]);
    expect(headerValues(init, "origin")).toEqual([]);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(SECRET_PATH, "utf8");
  });

  it("reads the secret again on every call", async () => {
    const { http, calls, readFile, state } = setup(respond(200, json({})));
    await http.send("POST", "/focus/window/100");
    state.secret = "def\n";
    await http.send("POST", "/focus/window/100");
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(headerValues(calls[0].init, "authorization")).toEqual(["Bearer abc"]);
    expect(headerValues(calls[1].init, "authorization")).toEqual(["Bearer def"]);
  });

  it("sends a PATCH body as JSON and returns the status", async () => {
    const { http, calls } = setup(respond(202, json({ state: "pending" })));
    const answer = await http.send("PATCH", "/journal/items/a1", { status: "done" });
    expect(answer).toEqual({ status: 202, json: { state: "pending" } });
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].init.body).toBe('{"status":"done"}');
  });

  it("does not call fetch when the secret is missing", async () => {
    const { http, fetch } = setup(respond(200, json({})), { secret: null });
    const err = await failure(http.send("POST", "/focus/window/100"));
    expect(err.kind).toBe("no_secret");
    expect(err.message).toContain(SECRET_PATH);
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("does not call fetch when the secret is not a single token", async () => {
    const { http, fetch } = setup(respond(200, json({})), { secret: "ab cd" });
    expect((await failure(http.send("POST", "/focus/window/100"))).kind).toBe("bad_secret");
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("refuses a bad base URL before reading the secret", async () => {
    const { http, fetch, readFile } = setup(respond(200, json({})), { baseUrl: "https://127.0.0.1:7319" });
    expect((await failure(http.send("POST", "/focus/window/100"))).kind).toBe("bad_base_url");
    expect(readFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

interface StatusCase {
  name: string;
  answer: Answer;
  kind: FylgjaErrorKind;
  message: string;
  excludes?: string;
}

const STATUS_CASES: StatusCase[] = [
  {
    name: "404 with a Fylgja detail",
    answer: respond(404, json({ detail: "window not found" })),
    kind: "not_found",
    message: "window not found",
  },
  {
    name: "404 Not Found",
    answer: respond(404, json({ detail: "Not Found" })),
    kind: "route_missing",
    message: "This Fylgja daemon is older than the extension",
  },
  {
    name: "405",
    answer: respond(405, json({ detail: "Method Not Allowed" })),
    kind: "route_missing",
    message: "This Fylgja daemon is older than the extension",
  },
  {
    name: "409 with a detail",
    answer: respond(409, json({ detail: "session has no window" })),
    kind: "conflict",
    message: "session has no window",
  },
  {
    name: "409 the journal is off",
    answer: respond(409, json({ detail: "the journal is off" })),
    kind: "journal_off",
    message: "The journal is off in Fylgja: set [journal] enabled = true",
  },
  {
    name: "409 summaries disabled",
    answer: respond(409, json({ scope: "folder", ref: "x", state: "disabled" })),
    kind: "summaries_off",
    message: "Summaries are off in Fylgja",
  },
  {
    name: "422 with a string detail",
    answer: respond(422, json({ detail: "invalid body (check: status)" })),
    kind: "unprocessable",
    message: "invalid body (check: status)",
  },
  {
    name: "422 with a FastAPI detail list",
    answer: respond(
      422,
      json({
        detail: [
          { type: "bool_parsing", loc: ["query", "open"], msg: "Input should be a valid boolean", input: "maybe" },
        ],
      }),
    ),
    kind: "unprocessable",
    message: "Input should be a valid boolean",
    excludes: "maybe",
  },
  {
    name: "401",
    answer: respond(401, json({ detail: "a valid bearer secret is required" })),
    kind: "unauthorized",
    message:
      "Fylgja refused the API secret. The daemon reads it only at start: restart it after `fylgja install secret`",
  },
  {
    name: "403 Host not allowed",
    answer: respond(403, json({ detail: "Host not allowed" })),
    kind: "host_rejected",
    message: "The daemon refused the address; use http://127.0.0.1:7319",
  },
  {
    name: "400 missing or repeated Host header",
    answer: respond(400, json({ detail: "missing or repeated Host header" })),
    kind: "host_rejected",
    message: "The daemon refused the address; use http://127.0.0.1:7319",
  },
  {
    name: "403 Origin not allowed",
    answer: respond(403, json({ detail: "Origin not allowed" })),
    kind: "bad_request",
    message: "Extension bug: Origin not allowed",
  },
  {
    name: "413",
    answer: respond(413, json({ detail: "request body too large" })),
    kind: "bad_request",
    message: "Extension bug: request body too large",
  },
  {
    name: "415",
    answer: respond(415, json({ detail: "Content-Type must be application/json" })),
    kind: "bad_request",
    message: "Extension bug: Content-Type must be application/json",
  },
  {
    name: "502 with a detail",
    answer: respond(502, json({ detail: "aerospace focus: timeout" })),
    kind: "upstream",
    message: "aerospace focus: timeout",
  },
  {
    name: "502 with an empty body",
    answer: respond(502, ""),
    kind: "upstream",
    message: "An AeroSpace step failed",
  },
  {
    name: "500 text/plain",
    answer: respond(500, "Internal Server Error", "text/plain"),
    kind: "server_error",
    message: "Fylgja answered 500",
  },
  {
    name: "500 HTML",
    answer: respond(500, "<!DOCTYPE html><html><body><h1>500</h1></body></html>", "text/html"),
    kind: "server_error",
    message: "Fylgja answered 500",
  },
  {
    name: "307",
    answer: () => new Response(null, { status: 307, headers: { location: "http://127.0.0.1:7320/x" } }),
    kind: "bad_response",
    message: "http://127.0.0.1:7319 answers, but not as Fylgja",
  },
];

describe.each(["GET", "POST"] as const)("status mapping (R6) for %s", (method) => {
  it.each(STATUS_CASES)("$name → $kind", async ({ answer, kind, message, excludes }) => {
    const { http, fetch } = setup(answer);
    const call = method === "GET" ? http.get("/items") : http.send("POST", "/focus/window/100");
    const err = await failure(call);
    expect(err.kind).toBe(kind);
    expect(err.message).toBe(message);
    expect(err.status).toBeGreaterThanOrEqual(300);
    if (excludes) expect(inspect(err)).not.toContain(excludes);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("status details", () => {
  it("keeps the cleaned detail and the status on the error", async () => {
    const { http } = setup(respond(404, json({ detail: "nothing is focused" })));
    const err = await failure(http.get("/journal/focused"));
    expect(err).toMatchObject({ kind: "not_found", status: 404, detail: "nothing is focused" });
  });

  it("cuts a long detail to 300 characters without control characters", async () => {
    const detail = `${"x".repeat(150)}\n${"y".repeat(100)}\u0007${"z".repeat(148)}`;
    expect(detail).toHaveLength(400);
    const { http } = setup(respond(422, json({ detail })));
    const err = await failure(http.get("/items"));
    expect(err.message.length).toBeLessThanOrEqual(300);
    // eslint-disable-next-line no-control-regex
    expect(err.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(err.message.startsWith("x".repeat(150) + " y")).toBe(true);
  });

  it("cleanDetail keeps strings, joins msg values and ignores everything else", () => {
    expect(cleanDetail({ detail: "a\tb" })).toBe("a b");
    expect(cleanDetail({ detail: [{ msg: "one", input: "secret-ish" }, { msg: "two" }, { input: "x" }] })).toBe(
      "one; two",
    );
    expect(cleanDetail({ detail: 3 })).toBeUndefined();
    expect(cleanDetail({ detail: "  " })).toBeUndefined();
    expect(cleanDetail("detail")).toBeUndefined();
    expect(cleanDetail(null)).toBeUndefined();
    expect(cleanDetail([{ detail: "x" }])).toBeUndefined();
    expect(cleanDetail({ detail: "😀".repeat(200) })).toBe("😀".repeat(150));
  });
});

const BAD_BODIES: [string, string][] = [
  ["an HTML page", "<!DOCTYPE html><html><body>hi</body></html>"],
  ["an empty body", ""],
  ["null", "null"],
  ["an array", "[]"],
  ["a JSON string", '"x"'],
  ["truncated JSON", '{"schema":"fylgja.items/1","items":['],
];

describe("2xx bodies that are not a JSON object", () => {
  it.each(BAD_BODIES)("%s → bad_response, never a TypeError", async (_label, body) => {
    const { http } = setup(respond(200, body, "text/html"));
    const err = await failure(http.get("/items"));
    expect(err).not.toBeInstanceOf(TypeError);
    expect(err.kind).toBe("bad_response");
    expect(err.message).toBe("http://127.0.0.1:7319 answers, but not as Fylgja");
  });
});

function codeError(code: string): Error {
  return Object.assign(new Error(`connect ${code} 127.0.0.1:7319`), { code });
}

const TRANSPORT_CASES: [string, () => unknown, FylgjaErrorKind][] = [
  [
    "ECONNREFUSED on the cause",
    () => new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }),
    "daemon_down",
  ],
  [
    "ECONNREFUSED inside an AggregateError cause",
    () =>
      new TypeError("fetch failed", {
        cause: new AggregateError([codeError("ECONNREFUSED"), codeError("ECONNREFUSED")], "connect failed"),
      }),
    "daemon_down",
  ],
  ["ECONNRESET", () => new TypeError("fetch failed", { cause: codeError("ECONNRESET") }), "daemon_down"],
  ["UND_ERR_SOCKET", () => new TypeError("fetch failed", { cause: codeError("UND_ERR_SOCKET") }), "daemon_down"],
  ["EHOSTUNREACH on the error", () => codeError("EHOSTUNREACH"), "daemon_down"],
  ["ENOTFOUND", () => new TypeError("fetch failed", { cause: codeError("ENOTFOUND") }), "network"],
  ["a plain TypeError", () => new TypeError("fetch failed"), "network"],
  [
    "a refused redirect",
    () => new TypeError("fetch failed", { cause: new Error("unexpected redirect") }),
    "bad_response",
  ],
];

describe("transport failures", () => {
  it.each(TRANSPORT_CASES)("%s → %s", async (_label, makeError, kind) => {
    const { http } = setup(async () => {
      throw makeError();
    });
    const err = await failure(http.get("/items"));
    expect(err.kind).toBe(kind);
    if (kind === "daemon_down") expect(err.message).toBe("The Fylgja daemon is not running on 127.0.0.1:7319");
    if (kind === "network") expect(err.message).toBe("Cannot reach http://127.0.0.1:7319");
  });
});

describe("timeouts and aborts", () => {
  async function expectTimeout(run: () => Promise<unknown>, ms: number) {
    vi.useFakeTimers();
    let settled = false;
    const result = run().then(
      () => undefined,
      (err: unknown) => err,
    );
    void result.finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await result;
    expect(err).toBeInstanceOf(FylgjaError);
    expect((err as FylgjaError).kind).toBe("timeout");
    expect((err as FylgjaError).message).toBe(`Fylgja did not answer within ${ms / 1000} s`);
    expect(vi.getTimerCount()).toBe(0);
  }

  it("times out a GET after 5 s and aborts the fetch signal", async () => {
    const { http, calls } = setup(never);
    await expectTimeout(() => http.get("/items"), 5_000);
    expect(calls[0].init.signal?.aborted).toBe(true);
  });

  it("times out a /focus/ POST after 15 s", async () => {
    const { http } = setup(never);
    await expectTimeout(() => http.send("POST", "/focus/session/claude%3Aabc"), 15_000);
  });

  it("times out any other POST or PATCH after 10 s", async () => {
    const { http } = setup(never);
    await expectTimeout(() => http.send("POST", "/summaries/folder/abc"), 10_000);
    await expectTimeout(() => http.send("PATCH", "/journal/items/a1", { pinned: true }), 10_000);
  });

  it("takes a timeoutMs override", async () => {
    const { http } = setup(never);
    await expectTimeout(() => http.get("/journal/focused", {}, { timeoutMs: 4_000 }), 4_000);
  });

  it("times out while the body is pending", async () => {
    const { http } = setup(() => new Response(new ReadableStream({ start: () => undefined }), { status: 200 }));
    await expectTimeout(() => http.get("/items"), 5_000);
  });

  it("maps a caller abort while fetch is pending to aborted", async () => {
    const { http, calls } = setup(never);
    const controller = new AbortController();
    const result = failure(http.get("/items", {}, { signal: controller.signal }));
    await nextTurn();
    controller.abort();
    const err = await result;
    expect(err.kind).toBe("aborted");
    expect(calls[0].init.signal?.aborted).toBe(true);
  });

  it("maps a caller abort while the body is pending to aborted and returns no value", async () => {
    const { http, calls } = setup(() => new Response(new ReadableStream({ start: () => undefined }), { status: 200 }));
    const controller = new AbortController();
    const onValue = vi.fn();
    const result = failure(http.get("/items", {}, { signal: controller.signal }).then(onValue));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await nextTurn();
    controller.abort();
    expect((await result).kind).toBe("aborted");
    expect(onValue).not.toHaveBeenCalled();
  });

  it("maps an AbortError rejected by fetch after a caller abort to aborted", async () => {
    const controller = new AbortController();
    const { http } = setup(async () => {
      controller.abort();
      throw new DOMException("This operation was aborted", "AbortError");
    });
    expect((await failure(http.get("/items", {}, { signal: controller.signal }))).kind).toBe("aborted");
  });

  it("does not send when the caller aborted before the call", async () => {
    const { http, fetch, readFile } = setup(respond(200, json({})));
    const controller = new AbortController();
    controller.abort();
    expect((await failure(http.send("POST", "/focus/window/1", {}, { signal: controller.signal }))).kind).toBe(
      "aborted",
    );
    expect(readFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send when the caller aborts while the secret is read", async () => {
    const { http, fetch, readFile } = setup(respond(200, json({})));
    let release: (value: string) => void = () => undefined;
    readFile.mockImplementationOnce(() => new Promise<string>((resolve) => (release = resolve)));
    const controller = new AbortController();
    const result = failure(http.send("POST", "/focus/window/1", {}, { signal: controller.signal }));
    await nextTurn();
    controller.abort();
    release("abc");
    expect((await result).kind).toBe("aborted");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("secret safety", () => {
  function post(answer: Answer, options: RequestOptions = {}, secret: string | null = SAFE_SECRET) {
    return setup(answer, { secret }).http.send("POST", "/focus/window/100", {}, options);
  }

  const scenarios: [string, () => Promise<unknown>][] = [
    ...STATUS_CASES.map(({ name, answer }): [string, () => Promise<unknown>] => [name, () => post(answer)]),
    ...BAD_BODIES.map(([label, body]): [string, () => Promise<unknown>] => [
      `2xx ${label}`,
      () => post(respond(200, body)),
    ]),
    ...TRANSPORT_CASES.map(([label, makeError]): [string, () => Promise<unknown>] => [
      label,
      () =>
        post(async () => {
          throw makeError();
        }),
    ]),
    ["timeout", () => post(never, { timeoutMs: 5 })],
    [
      "aborted",
      () => {
        const controller = new AbortController();
        const call = post(never, { signal: controller.signal });
        setTimeout(() => controller.abort(), 5);
        return call;
      },
    ],
    ["missing secret", () => post(respond(200, json({})), {}, null)],
    ["bad secret", () => post(respond(200, json({})), {}, `${SAFE_SECRET} ${SAFE_SECRET}\nmore`)],
    ["secret with a non-ASCII character", () => post(respond(200, json({})), {}, `${SAFE_SECRET}æ`)],
  ];

  it("never puts the secret into an error or the console", async () => {
    const logged: unknown[] = [];
    for (const level of ["log", "info", "warn", "error", "debug", "trace"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    expect(scenarios.length).toBeGreaterThan(30);
    for (const [name, run] of scenarios) {
      const err = await failure(run());
      for (const text of [err.message, String(err), JSON.stringify(err), inspect(err, { depth: 10 })]) {
        expect(text, name).not.toContain(SAFE_SECRET);
      }
    }
    expect(logged.map((entry) => inspect(entry, { depth: 10 })).join("\n")).not.toContain(SAFE_SECRET);
  });
});
