/**
 * The request core every daemon call goes through (R3-R6): base URL check, headers, the secret per POST/PATCH,
 * timeouts, abort handling, `redirect: "error"`, body parsing and the mapping of every failure to a `FylgjaError`.
 * Plain TypeScript (R2): `fetch`, `readFile` and `homedir` are injected.
 */

import { parseBaseUrl } from "./base-url";
import { cleanDetail, FylgjaError, messages } from "./errors";
import { readSecret, type SecretDeps } from "./secret";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpDeps extends SecretDeps {
  /** The `baseUrl` preference as entered; checked before every request. */
  baseUrl: string | undefined;
  /** The `secretFile` preference as entered; read on every POST/PATCH. */
  secretFile: string | undefined;
  fetch: FetchLike;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type QueryValue = string | number | boolean | undefined | null;
export type QueryParams = Record<string, QueryValue>;
export type JsonObject = Record<string, unknown>;

export interface HttpResponse {
  status: number;
  json: JsonObject;
}

export interface Http {
  get(path: string, params?: QueryParams, options?: RequestOptions): Promise<HttpResponse>;
  send(method: "POST" | "PATCH", path: string, body?: object, options?: RequestOptions): Promise<HttpResponse>;
}

export const GET_TIMEOUT_MS = 5_000;
export const FOCUS_TIMEOUT_MS = 15_000;
export const SEND_TIMEOUT_MS = 10_000;

const DOWN_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "UND_ERR_SOCKET"]);

export function createHttp(deps: HttpDeps): Http {
  return {
    get: (path, params = {}, options = {}) => request(deps, "GET", path, params, undefined, options),
    send: (method, path, body = {}, options = {}) => request(deps, method, path, {}, body, options),
  };
}

type Method = "GET" | "POST" | "PATCH";

async function request(
  deps: HttpDeps,
  method: Method,
  path: string,
  params: QueryParams,
  body: object | undefined,
  options: RequestOptions,
): Promise<HttpResponse> {
  const baseUrl = parseBaseUrl(deps.baseUrl);
  const url = baseUrl + path + queryString(params);
  const caller = options.signal;
  if (caller?.aborted) throw abortedError();

  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: string | undefined;
  if (method !== "GET") {
    let secret: string;
    try {
      secret = await readSecret(deps.secretFile, deps);
    } catch (err) {
      if (caller?.aborted) throw abortedError();
      throw err;
    }
    if (caller?.aborted) throw abortedError();
    headers.Authorization = `Bearer ${secret}`;
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body ?? {});
  }

  const timeoutMs = options.timeoutMs ?? defaultTimeout(method, path);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  caller?.addEventListener("abort", onCallerAbort, { once: true });
  // Settles (rejects) when the request is cancelled, so an injected `fetch` or body that ignores the signal cannot
  // keep the request pending.
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  });
  cancelled.catch(() => undefined);

  const stopped = (): FylgjaError | undefined => {
    if (caller?.aborted) return abortedError();
    if (timedOut) return new FylgjaError("timeout", messages.timeout(timeoutMs / 1000));
    return undefined;
  };

  try {
    let response: Response;
    try {
      response = await Promise.race([
        deps.fetch(url, {
          method,
          headers,
          ...(payload === undefined ? {} : { body: payload }),
          redirect: "error",
          signal: controller.signal,
        }),
        cancelled,
      ]);
    } catch (err) {
      throw stopped() ?? transportError(err, baseUrl);
    }
    const halted = stopped();
    if (halted) throw halted;

    const status = response.status;
    const ok = status >= 200 && status < 300;
    let text: string;
    try {
      text = await Promise.race([response.text(), cancelled]);
    } catch (err) {
      const reason = stopped();
      if (reason) throw reason;
      if (ok) throw transportError(err, baseUrl);
      text = "";
    }
    const late = stopped();
    if (late) throw late;

    if (ok) {
      const json = parseJson(text);
      if (typeof json !== "object" || json === null || Array.isArray(json)) {
        throw new FylgjaError("bad_response", messages.bad_response(baseUrl), { status });
      }
      return { status, json: json as JsonObject };
    }
    throw statusError(status, parseJson(text), baseUrl);
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", onCallerAbort);
  }
}

function defaultTimeout(method: Method, path: string): number {
  if (method === "GET") return GET_TIMEOUT_MS;
  return path.startsWith("/focus/") ? FOCUS_TIMEOUT_MS : SEND_TIMEOUT_MS;
}

/** `?a=b&…` from the parameters that carry a value (not empty, whitespace-only, `false`, `undefined` or `null`). */
function queryString(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    search.append(name, String(value));
  }
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function abortedError(): FylgjaError {
  return new FylgjaError("aborted", messages.aborted());
}

/** A rejected `fetch` (or body read) mapped to a kind. Its cause is not kept: only the codes are read from it. */
function transportError(err: unknown, baseUrl: string): FylgjaError {
  if (nameOf(err) === "AbortError") return abortedError();
  const cause = fieldOf(err, "cause");
  // `redirect: "error"` makes Node's fetch reject a redirect with `TypeError("fetch failed")`, cause "unexpected
  // redirect"; the bearer never follows it.
  if (fieldOf(cause, "message") === "unexpected redirect") {
    return new FylgjaError("bad_response", messages.bad_response(baseUrl));
  }
  const nested = fieldOf(cause, "errors");
  const codes = [
    fieldOf(err, "code"),
    fieldOf(cause, "code"),
    ...(Array.isArray(nested) ? nested.map((e: unknown) => fieldOf(e, "code")) : []),
  ];
  if (codes.some((code) => typeof code === "string" && DOWN_CODES.has(code))) {
    return new FylgjaError("daemon_down", messages.daemon_down(baseUrl.replace(/^http:\/\//, "")));
  }
  return new FylgjaError("network", messages.network(baseUrl));
}

/** A non-2xx answer mapped to a kind (R6). */
function statusError(status: number, body: unknown, baseUrl: string): FylgjaError {
  const detail = cleanDetail(body);
  const extra = { status, ...(detail === undefined ? {} : { detail }) };
  const fallback = messages.server_error(status);
  if (status >= 300 && status < 400) return new FylgjaError("bad_response", messages.bad_response(baseUrl), extra);
  const port = baseUrl.slice(baseUrl.lastIndexOf(":") + 1);
  switch (status) {
    case 400:
      if (detail === "missing or repeated Host header") {
        return new FylgjaError("host_rejected", messages.host_rejected(port), extra);
      }
      break;
    case 401:
      return new FylgjaError("unauthorized", messages.unauthorized(), extra);
    case 403:
      if (detail === "Host not allowed") return new FylgjaError("host_rejected", messages.host_rejected(port), extra);
      if (detail === "Origin not allowed") return new FylgjaError("bad_request", messages.bad_request(detail), extra);
      break;
    case 404:
      if (detail === "Not Found") return new FylgjaError("route_missing", messages.route_missing(), extra);
      if (detail !== undefined) return new FylgjaError("not_found", messages.not_found(detail), extra);
      break;
    case 405:
      return new FylgjaError("route_missing", messages.route_missing(), extra);
    case 409:
      if (detail === "the journal is off") return new FylgjaError("journal_off", messages.journal_off(), extra);
      if (fieldOf(body, "state") === "disabled") {
        return new FylgjaError("summaries_off", messages.summaries_off(), extra);
      }
      if (detail !== undefined) return new FylgjaError("conflict", messages.conflict(detail), extra);
      break;
    case 413:
    case 415:
      return new FylgjaError("bad_request", messages.bad_request(detail ?? fallback), extra);
    case 422:
      return new FylgjaError("unprocessable", messages.unprocessable(detail ?? fallback), extra);
    case 502:
      return new FylgjaError("upstream", messages.upstream(detail), extra);
  }
  return new FylgjaError("server_error", fallback, extra);
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function nameOf(value: unknown): unknown {
  return fieldOf(value, "name");
}
