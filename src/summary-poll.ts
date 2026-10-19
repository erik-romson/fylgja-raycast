/** Summary dispatch and polling with injected effects. Plain TypeScript (R2). */
import { FylgjaError } from "./fylgja/errors";
import type { SummarizeResult, SummaryResponse } from "./fylgja/types";

export type SummarizeOutcome =
  | { type: "poll" }
  | { type: "refetch" }
  | { type: "toast-refetch"; message: string }
  | { type: "toast-hide"; message: string }
  | { type: "toast"; message: string }
  | { type: "none" };

/** What to do with the answer (or error) of `POST /summaries/folder/{id}`. */
export function onSummarizeAnswer(answer: SummarizeResult | FylgjaError): SummarizeOutcome {
  if (answer instanceof FylgjaError) {
    switch (answer.kind) {
      case "aborted":
        return { type: "none" };
      case "summaries_off":
        return { type: "toast-hide", message: answer.message };
      case "not_found":
        return { type: "toast-refetch", message: answer.detail ?? answer.message };
      default:
        return { type: "toast", message: answer.message };
    }
  }
  if (answer.status === 202 || answer.state === "pending") return { type: "poll" };
  if (answer.state === "fresh") return { type: "refetch" };
  // Fylgja's 300 s TTL: no job was started.
  const kind = answer.error_kind ? `, ${answer.error_kind}` : "";
  return {
    type: "toast-refetch",
    message: `Fylgja tried within the last 5 minutes (${answer.state}${kind}); try again later`,
  };
}

export type PollState = "fresh" | "stale" | "failed" | "missing" | "disabled" | "gone" | "timeout";

export interface PollResult {
  state: PollState;
  error_kind?: string;
}

export interface PollDeps {
  get: (id: string, signal?: AbortSignal) => Promise<SummaryResponse>;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  intervalMs?: number;
  capMs?: number;
  now?: () => number;
}

const MAX_TRANSPORT_ERRORS = 3;
const TRANSPORT_KINDS = new Set(["daemon_down", "network", "timeout"]);
const STOP_STATES = new Set(["fresh", "stale", "failed", "missing", "disabled"]);

function aborted(): FylgjaError {
  return new FylgjaError("aborted", "The request was cancelled");
}

/** Resolves with `work`, or rejects `aborted` as soon as the signal fires. */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => {});
    return Promise.reject(aborted());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Polls `GET /summaries/folder/{id}` while it is pending. The next GET starts `intervalMs` after the previous one
 * finished. Rejects `aborted` on abort, and with the error on the third transport error in a row.
 */
export async function pollSummary(id: string, deps: PollDeps): Promise<PollResult> {
  const { get, sleep, signal, intervalMs = 2000, capMs = 120000, now = Date.now } = deps;
  const start = now();
  let failures = 0;
  for (;;) {
    if (signal?.aborted) throw aborted();
    let answer: SummaryResponse | undefined;
    try {
      answer = await raceAbort(get(id, signal), signal);
      failures = 0;
    } catch (err) {
      if (signal?.aborted || (err instanceof FylgjaError && err.kind === "aborted")) throw aborted();
      if (err instanceof FylgjaError && err.kind === "not_found") return { state: "gone" };
      if (!(err instanceof FylgjaError) || !TRANSPORT_KINDS.has(err.kind)) throw err;
      failures += 1;
      if (failures >= MAX_TRANSPORT_ERRORS) throw err;
    }
    if (signal?.aborted) throw aborted();
    if (answer !== undefined && STOP_STATES.has(answer.state)) {
      return {
        state: answer.state as PollState,
        ...(answer.state === "failed" && answer.error_kind ? { error_kind: answer.error_kind } : {}),
      };
    }
    await raceAbort(sleep(intervalMs, signal), signal);
    if (now() - start >= capMs) return { state: "timeout" };
  }
}
