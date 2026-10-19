/** Text formatting for the list, the detail pane and the menu bar. Plain TypeScript (R2). */

/** Whitespace runs (newlines and tabs included) become one space; the result is trimmed. */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** `s` cut to at most `max` code points, ending with one `…` when cut. Never splits a surrogate pair. */
export function truncate(s: string, max: number): string {
  if (max < 1) return "";
  const points = Array.from(s);
  if (points.length <= max) return s;
  return points.slice(0, max - 1).join("") + "…";
}

/** Whole seconds as `Ns`, `Nm`, `Nh` or `Nh Mm`. `NaN`, negative and `undefined` give `0s`. */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "0s";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** How long before `now` the ISO time `iso` was: `just now`, `30s ago`, `5m ago`, `2h ago`, `3d ago`. `""` when unparsable. */
export function formatAgo(iso: string | undefined, now: Date | number): string {
  if (iso === undefined || iso === "") return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const nowMs = typeof now === "number" ? now : now.getTime();
  const seconds = Math.floor((nowMs - then) / 1000);
  if (seconds < 1) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Escapes `s` so no image, link, HTML, heading, rule, list, quote, table or code structure survives in markdown. The
 * text stays readable: every special character is backslash-escaped, and leading indentation, which markdown drops
 * from paragraph lines anyway, is removed so no line becomes an indented code block.
 */
export function escapeMarkdown(s: string): string {
  return s
    .replace(/[\\`*_[\]()<>#|!~]/g, "\\$&")
    .replace(/^[ \t]+/gm, "")
    .replace(/^(\d{1,9})([.)])(?=[ \t]|$)/gm, "$1\\$2")
    .replace(/^([-+=])(?=[ \t]|$|\1)/gm, "\\$1");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The label of a daemon day (`YYYY-MM-DD`, local time) as seen from `now`: `Today`, `Yesterday`, `Mon 12 Oct` for 2-6
 * days back, `12 Oct 2026` for older or future days. Anything that is not a `YYYY-MM-DD` date is returned as is.
 * Compares calendar dates in local time, so DST days and year ends are right.
 */
export function dayLabel(day: string, now: Date | number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const asUtc = new Date(Date.UTC(year, month - 1, date));
  if (asUtc.getUTCFullYear() !== year || asUtc.getUTCMonth() !== month - 1 || asUtc.getUTCDate() !== date) return day;

  const nowDate = typeof now === "number" ? new Date(now) : now;
  const today = Date.UTC(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const back = Math.round((today - asUtc.getTime()) / 86_400_000);
  if (back === 0) return "Today";
  if (back === 1) return "Yesterday";
  const monthName = MONTHS[month - 1];
  if (back >= 2 && back <= 6) return `${WEEKDAYS[asUtc.getUTCDay()]} ${date} ${monthName}`;
  return `${date} ${monthName} ${year}`;
}

// Markers at the start of a line: `#`, `>`, `-`, `*`, `1.`. A marker other than `>` needs whitespace (or the end) after it.
const LINE_MARKERS = /^(?:\s*(?:#+|[-*]|\d+\.)(?:\s+|$)|\s*>\s*)+/;
// `.`, `!` or `?` followed by whitespace and an uppercase letter, a digit or a quote, or by the end of the text.
const SENTENCE_STOP = /[.!?]+(?=\s+[\p{Lu}\p{N}"'“‘”’]|\s*$)/u;

/** `s` cut to at most `max` code points on a word boundary, ending with `…` when cut. */
function cutOnWord(s: string, max: number): string {
  const points = Array.from(s);
  if (points.length <= max) return s;
  if (max < 2) return max < 1 ? "" : "…";
  const head = points.slice(0, max - 1).join("");
  const atBoundary = /\s/.test(points[max - 1]);
  const lastSpace = head.search(/\s\S*$/);
  // Cut back to the last whole word, unless that leaves nothing.
  const whole = atBoundary || lastSpace <= 0 ? head : head.slice(0, lastSpace);
  const kept = whole.replace(/[\s,;:]+$/, "");
  return `${kept}…`;
}

/**
 * The first sentence of the first line of `text`, for the menu bar. Markdown markers at the start of the line are
 * dropped. A sentence ends at `.`, `!` or `?` followed by whitespace and an uppercase letter, a digit or a quote, or by
 * the end of the text, so `v1.2.3`, `e.g.` and `foo.ts` do not end it. Without such a stop, or when the sentence is
 * longer than `max` code points, the text is cut on a word boundary with `…`. Empty, `undefined` and punctuation-only
 * input give `""`.
 */
export function firstSentence(text: string | undefined, max: number): string {
  if (text === undefined) return "";
  const line = (text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "").replace(LINE_MARKERS, "");
  const flat = oneLine(line);
  const stop = SENTENCE_STOP.exec(flat);
  const sentence = stop ? flat.slice(0, stop.index + stop[0].length) : flat;
  if (!/[\p{L}\p{N}]/u.test(sentence)) return "";
  return cutOnWord(sentence, max);
}
