/**
 * The ranker dropdown's rules: options, the effective rank, stale-choice handling and the single unknown-ranker 422
 * refetch. Plain TypeScript (R2). The daemon names the rankers (R1): no ranker name is hard-coded here.
 */
import { FylgjaError } from "./fylgja/errors";
import type { Rankers } from "./fylgja/types";
import { oneLine, truncate } from "./format";

export interface RankerOption {
  /** `""` for the default (no `rank` parameter), else the ranker name exactly as the daemon sent it. */
  value: string;
  title: string;
  description?: string;
}

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 200;
const UNKNOWN_RANK_DETAIL = "rank must name a loaded ranker";
/** How many times one open refetches `/items` without the rank after an unknown-ranker 422. */
const MAX_RANK_RETRIES = 1;

function option(value: string, title: string, description: string | undefined): RankerOption {
  const out: RankerOption = { value, title: truncate(oneLine(title), TITLE_MAX) };
  const text = description === undefined ? "" : truncate(oneLine(description), DESCRIPTION_MAX);
  if (text !== "") out.description = text;
  return out;
}

/**
 * The dropdown options: `choices` in the order sent. The default choice gets value `""` and the title
 * `<name> (default)`. When no choice is the default (the daemon falls back to its floor), a first option `""` titled
 * `<default> (fallback)` with the answer's `default` name. Without an answer (loading or a `/rankers` failure), only
 * the `""` option, titled `Default`.
 */
export function rankerOptions(answer: Pick<Rankers, "choices" | "default"> | undefined): RankerOption[] {
  if (!answer) return [{ value: "", title: "Default" }];
  const choices = answer.choices ?? [];
  const options = choices.map((choice) =>
    choice.default
      ? option("", `${choice.name} (default)`, choice.description)
      : option(choice.name, choice.name, choice.description),
  );
  if (!choices.some((choice) => choice.default)) {
    options.unshift(option("", `${answer.default} (fallback)`, undefined));
  }
  return options;
}

/** The rank to send: the stored choice when there is one (`""` included), else the trimmed preference. */
export function effectiveRank(stored: string | null, pref: string): string {
  return stored !== null ? stored : pref.trim();
}

export interface AfterRankers {
  /** The stored choice to keep: `null` when the daemon called the stored choice stale. */
  storedNext: string | null;
  /** False when the preference names no choice; it is then skipped for the rest of this run. */
  prefUsable: boolean;
}

/**
 * What a `/rankers` answer means for the stored choice and the preference. `answer` must be the answer to
 * `/rankers?rank=<effectiveRank(stored, pref)>`.
 */
export function afterRankers(
  stored: string | null,
  pref: string,
  answer: Pick<Rankers, "choices" | "stale_choice">,
): AfterRankers {
  const storedNext = stored !== null && answer.stale_choice ? null : stored;
  const wanted = pref.trim();
  const prefUsable = wanted === "" || (answer.choices ?? []).some((choice) => choice.name === wanted);
  return { storedNext, prefUsable };
}

/** True only for the daemon's "unknown ranker" 422 on a request that carried a rank. */
export function isUnknownRank422(error: unknown, rankSent: string): boolean {
  return (
    error instanceof FylgjaError &&
    error.kind === "unprocessable" &&
    rankSent !== "" &&
    typeof error.detail === "string" &&
    error.detail.startsWith(UNKNOWN_RANK_DETAIL)
  );
}

/**
 * Whether to refetch `/items` without the rank after `error`. `attempts` is how many such refetches this open already
 * made. The first unknown-ranker 422 refetches; a second one stops, so `/items` is called at most twice.
 */
export function planRankRetry(attempts: number, error: unknown, rankSent: string): boolean {
  return attempts < MAX_RANK_RETRIES && isUnknownRank422(error, rankSent);
}

/**
 * The stored value to write after the dropdown reports `next`, or `null` for no change. `current` is the value the
 * dropdown shows, so an echo of the shown value (on mount or when the options load) never writes.
 */
export function dropdownChange(current: string, next: string): string | null {
  return next === current ? null : next;
}

/** The dropdown's tooltip: the selected option's description, else `Ranker`. */
export function tooltipFor(options: readonly RankerOption[], value: string): string {
  return options.find((o) => o.value === value)?.description ?? "Ranker";
}

/** The dropdown's controlled value: `effective` when it is an option value, else `""`. */
export function dropdownValue(options: readonly RankerOption[], effective: string): string {
  return options.some((o) => o.value === effective) ? effective : "";
}
