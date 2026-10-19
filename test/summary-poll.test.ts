import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FylgjaError, messages } from "../src/fylgja/errors";
import type { SummarizeResult, SummaryResponse } from "../src/fylgja/types";
import { onSummarizeAnswer, pollSummary } from "../src/summary-poll";

const answer = (state: string, extra: Partial<SummaryResponse> = {}): SummaryResponse => ({
  scope: "folder",
  ref: "f1",
  state,
  ...extra,
});
const down = () => new FylgjaError("daemon_down", messages.daemon_down("127.0.0.1:7319"));

type Step = SummaryResponse | FylgjaError;

/** A `get` that plays the steps in order (the last one repeats), taking `latency` ms per call. */
function script(steps: Step[], latency = 0) {
  const calls: number[] = [];
  const get = vi.fn(async () => {
    calls.push(Date.now());
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    if (latency > 0) await new Promise<void>((r) => setTimeout(r, latency));
    if (step instanceof FylgjaError) throw step;
    return step;
  });
  return { get, calls };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("pollSummary", () => {
  it("polls pending, pending, fresh two seconds apart", async () => {
    const { get, calls } = script([answer("pending"), answer("pending"), answer("fresh")]);
    const result = pollSummary("f1", { get, sleep });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ state: "fresh" });
    expect(calls).toEqual([0, 2000, 4000]);
  });

  it("times out at 120 s with at most 61 GETs", async () => {
    const { get } = script([answer("pending")]);
    const result = pollSummary("f1", { get, sleep });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ state: "timeout" });
    expect(get.mock.calls.length).toBeLessThanOrEqual(61);
    expect(Date.now()).toBe(120000);
  });

  it("keeps error_kind on failed", async () => {
    const { get } = script([answer("pending"), answer("failed", { error_kind: "timeout" })]);
    const result = pollSummary("f1", { get, sleep });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ state: "failed", error_kind: "timeout" });
  });

  it.each(["missing", "disabled", "stale"])("stops on %s", async (state) => {
    const { get } = script([answer("pending"), answer(state)]);
    const result = pollSummary("f1", { get, sleep });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ state });
  });

  it("resolves gone on not_found", async () => {
    const { get } = script([answer("pending"), new FylgjaError("not_found", "no folder")]);
    const result = pollSummary("f1", { get, sleep });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ state: "gone" });
  });

  it("tolerates two transport errors and resets on a success", async () => {
    const { get } = script([down(), down(), answer("pending"), down(), down(), answer("fresh")]);
    const result = pollSummary("f1", { get, sleep });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ state: "fresh" });
  });

  it("rejects with the third transport error in a row", async () => {
    const error = down();
    const { get } = script([error]);
    const result = pollSummary("f1", { get, sleep });
    const caught = result.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await caught).toBe(error);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("rejects aborted when aborted during sleep, with nothing further started", async () => {
    const { get } = script([answer("pending")]);
    const controller = new AbortController();
    const caught = pollSummary("f1", { get, sleep, signal: controller.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    const error = await caught;
    expect(error).toBeInstanceOf(FylgjaError);
    expect((error as FylgjaError).kind).toBe("aborted");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("rejects aborted when aborted during a GET, with nothing further started", async () => {
    const { get } = script([answer("pending")], 3000);
    const controller = new AbortController();
    const caught = pollSummary("f1", { get, sleep, signal: controller.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    const error = await caught;
    expect((error as FylgjaError).kind).toBe("aborted");
    await vi.runAllTimersAsync();
    expect(get).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts the next GET 2 s after a 3 s GET finished", async () => {
    const { get, calls } = script([answer("pending"), answer("fresh")], 3000);
    const result = pollSummary("f1", { get, sleep });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ state: "fresh" });
    expect(calls).toEqual([0, 5000]);
  });
});

describe("onSummarizeAnswer", () => {
  const post = (status: number, body: SummaryResponse): SummarizeResult => ({ ...body, status });

  it("polls on 202 pending", () => {
    expect(onSummarizeAnswer(post(202, answer("pending")))).toEqual({ type: "poll" });
  });

  it("refetches on 200 fresh", () => {
    expect(onSummarizeAnswer(post(200, answer("fresh")))).toEqual({ type: "refetch" });
  });

  it("toasts and refetches on 200 stale", () => {
    expect(onSummarizeAnswer(post(200, answer("stale")))).toEqual({
      type: "toast-refetch",
      message: "Fylgja tried within the last 5 minutes (stale); try again later",
    });
  });

  it("appends error_kind on 200 failed", () => {
    expect(onSummarizeAnswer(post(200, answer("failed", { error_kind: "timeout" })))).toEqual({
      type: "toast-refetch",
      message: "Fylgja tried within the last 5 minutes (failed, timeout); try again later",
    });
  });

  it("toasts and hides on summaries_off", () => {
    expect(onSummarizeAnswer(new FylgjaError("summaries_off", messages.summaries_off()))).toEqual({
      type: "toast-hide",
      message: "Summaries are off in Fylgja",
    });
  });

  it("toasts the detail and refetches on not_found", () => {
    expect(onSummarizeAnswer(new FylgjaError("not_found", "No such folder", { detail: "unknown folder" }))).toEqual({
      type: "toast-refetch",
      message: "unknown folder",
    });
  });

  it("toasts the R6 message on other errors and nothing on aborted", () => {
    const error = down();
    expect(onSummarizeAnswer(error)).toEqual({ type: "toast", message: error.message });
    expect(onSummarizeAnswer(new FylgjaError("aborted", messages.aborted()))).toEqual({ type: "none" });
  });
});
