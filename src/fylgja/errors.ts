/** The errors every Fylgja call can end in, with the messages the UI shows (R6). Plain TypeScript (R2). */

export type FylgjaErrorKind =
  | "bad_base_url"
  | "no_secret"
  | "bad_secret"
  | "daemon_down"
  | "network"
  | "timeout"
  | "aborted"
  | "bad_response"
  | "schema"
  | "contract"
  | "host_rejected"
  | "unauthorized"
  | "not_found"
  | "route_missing"
  | "conflict"
  | "journal_off"
  | "summaries_off"
  | "unprocessable"
  | "upstream"
  | "bad_request"
  | "server_error";

export interface FylgjaErrorOptions {
  status?: number;
  detail?: string;
  seen?: string;
  /** Never an object that holds the secret or the secret file's content. */
  cause?: unknown;
}

export class FylgjaError extends Error {
  override readonly name = "FylgjaError";
  readonly kind: FylgjaErrorKind;
  declare readonly status?: number;
  declare readonly detail?: string;
  declare readonly seen?: string;

  constructor(kind: FylgjaErrorKind, message: string, options: FylgjaErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.detail !== undefined) this.detail = options.detail;
    if (options.seen !== undefined) this.seen = options.seen;
  }
}

/** The R6 message of each kind, exact text. */
export const messages = {
  bad_base_url: () => "The Fylgja address must look like http://127.0.0.1:7319",
  no_secret: (path: string) => `No Fylgja API secret at ${path}: run \`fylgja install secret\` and restart the daemon`,
  bad_secret: (path: string) => `The Fylgja API secret at ${path} is not a single-line token`,
  daemon_down: (hostPort: string) => `The Fylgja daemon is not running on ${hostPort}`,
  network: (baseUrl: string) => `Cannot reach ${baseUrl}`,
  timeout: (seconds: number) => `Fylgja did not answer within ${seconds} s`,
  aborted: () => "The request was cancelled",
  bad_response: (baseUrl: string) => `${baseUrl} answers, but not as Fylgja`,
  schema: (expected: string, seen?: string) =>
    `This extension speaks ${expected}; the daemon answers ${seen === undefined ? "no schema" : seen}`,
  contract: (what: string) => `Fylgja's day groups do not match its items (${what})`,
  host_rejected: (port: string) => `The daemon refused the address; use http://127.0.0.1:${port}`,
  unauthorized: () =>
    "Fylgja refused the API secret. The daemon reads it only at start: restart it after `fylgja install secret`",
  not_found: (detail: string, target?: "window" | "session") =>
    target === "window" ? "That window is gone" : target === "session" ? "That session has ended" : detail,
  route_missing: () => "This Fylgja daemon is older than the extension",
  conflict: (detail: string) => detail,
  journal_off: () => "The journal is off in Fylgja: set [journal] enabled = true",
  summaries_off: () => "Summaries are off in Fylgja",
  unprocessable: (detail: string) => detail,
  upstream: (detail?: string) => detail || "An AeroSpace step failed",
  bad_request: (detail: string) => `Extension bug: ${detail}`,
  server_error: (status: number) => `Fylgja answered ${status}`,
} satisfies Record<FylgjaErrorKind, (...args: never[]) => string>;

const DETAIL_MAX = 300;
// C0 controls, DEL and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * The daemon's `detail` from an error body, cleaned for display: a string is kept; an array (FastAPI 422) becomes its
 * `msg` values joined with `; ` (the echoed `input` values are never used); control characters become spaces; the
 * result is cut to 300 characters without splitting a surrogate pair. `undefined` when there is no usable detail.
 */
export function cleanDetail(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const detail = (body as { detail?: unknown }).detail;
  let text: string;
  if (typeof detail === "string") {
    text = detail;
  } else if (Array.isArray(detail)) {
    text = detail
      .map((entry: unknown) =>
        typeof entry === "object" && entry !== null ? (entry as { msg?: unknown }).msg : undefined,
      )
      .filter((msg): msg is string => typeof msg === "string")
      .join("; ");
  } else {
    return undefined;
  }
  const cleaned = cut(text.replace(CONTROL, " ").trim(), DETAIL_MAX);
  return cleaned === "" ? undefined : cleaned;
}

/** `text` cut to at most `max` UTF-16 units, never inside a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const codePoint of text) {
    if (out.length + codePoint.length > max) break;
    out += codePoint;
  }
  return out;
}
