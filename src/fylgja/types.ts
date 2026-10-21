/**
 * Types of the Navigator contract: `fylgja.items/1`, `fylgja.rankers/1`, the focus answer and the summaries answer.
 * Plain TypeScript (R2). A field without a value is absent, never `null` (R8). Lists are always present.
 * Unions of known values end in `(string & Record<never, never>)`, so an unknown value still type-checks and the client renders it
 * as a neutral tag.
 */

export const ITEMS_SCHEMA = "fylgja.items/1";
export const RANKERS_SCHEMA = "fylgja.rankers/1";

/** Waiting kinds, then `todo_next`, `dirty` and `pr_open`. `state[]` is sorted alphabetically by the daemon. */
export type ItemState =
  | "permission"
  | "input"
  | "turn_done"
  | "run_finished"
  | "build_failed"
  | "review_requested"
  | "unread"
  | "todo_next"
  | "dirty"
  | "pr_open"
  | (string & Record<never, never>);

export type PlaceRole = "agent" | "ide" | "terminal" | "app" | (string & Record<never, never>);

export type PlaceKind = "session" | "window";

export type SummaryState = "fresh" | "stale" | "pending" | "missing" | "failed" | "disabled";

export interface ScorePart {
  name: string;
  value: number;
}

export interface GoTarget {
  kind: PlaceKind;
  /** The session key or the window id. */
  ref: string;
}

export interface ItemPlace {
  kind: PlaceKind;
  ref: string;
  role: PlaceRole;
  /** The session kind or the app name. */
  label: string;
  title?: string;
  workspace?: string;
  open: boolean;
  waiting: boolean;
  last_focus_at?: string;
}

export interface ItemStory {
  /** `fresh`, `stale`, `pending` or `failed`. */
  state: SummaryState | (string & Record<never, never>);
  text?: string;
  generated_at?: string;
}

export interface ItemJournalNext {
  id: string;
  text: string;
}

/** The newest recap a session of the checkout wrote (Claude Code's `away_summary`). */
export interface ItemJournalRecap {
  text: string;
  at: string;
  /** The session key. */
  session: string;
}

export interface ItemJournal {
  thread: string;
  where?: string;
  recap?: ItemJournalRecap;
  next: ItemJournalNext[];
  next_more?: number;
}

export interface NavItem {
  id: string;
  /** `folder:<path>` or `app:<bundle id>`. */
  key: string;
  kind: "folder" | "app" | (string & Record<never, never>);
  name: string;
  path?: string;
  group?: string;
  tickets: string[];
  score: number;
  explanation: string;
  parts: ScorePart[];
  places: ItemPlace[];
  state: ItemState[];
  last_focus_at?: string;
  seconds_today: number;
  summary: string;
  go?: GoTarget;
  go_ide?: GoTarget;
  go_agent?: GoTarget;
  go_terminal?: GoTarget;
  story?: ItemStory;
  journal?: ItemJournal;
}

export interface DayGroup {
  /** `YYYY-MM-DD`, local time. */
  day: string;
  /** Item ids, in rank order. */
  items: string[];
}

export interface AwayChange {
  item: string;
  name: string;
  /** The waiting kind. */
  kind: ItemState;
  reason: string;
  since?: string;
  go?: GoTarget;
}

export interface LastSession {
  start: string;
  end: string;
  active_seconds: number;
  items: string[];
}

export interface ActivityInfo {
  working: boolean;
  away_since?: string;
  away_until?: string;
  session_started_at?: string;
  active_seconds_session: number;
}

export interface Items {
  schema: typeof ITEMS_SCHEMA;
  generated_at: string;
  ranker: string;
  ranker_fallback?: string;
  activity: ActivityInfo;
  while_away: AwayChange[];
  last_session?: LastSession;
  items: NavItem[];
  days: DayGroup[];
  summaries_enabled: boolean;
  query?: string;
  total: number;
  shown: number;
}

export interface RankerInfo {
  name: string;
  description?: string;
  origin: "built-in" | "external" | (string & Record<never, never>);
  distribution?: string;
  version?: string;
  enabled: boolean;
  loaded: boolean;
  error?: string;
}

export interface RankerChoice {
  name: string;
  description?: string;
  default: boolean;
}

export interface Rankers {
  schema: typeof RANKERS_SCHEMA;
  default: string;
  configured_default: string;
  rankers: RankerInfo[];
  choices: RankerChoice[];
  selected: string;
  stale_choice: boolean;
}

/** The answer of `POST /focus/window/{id}` and `POST /focus/session/{key}`. */
export interface FocusResult {
  focused: "window" | "tab" | (string & Record<never, never>);
  via: string;
}

export interface SummaryResponse {
  scope: string;
  ref: string;
  state: SummaryState | (string & Record<never, never>);
  arc?: string;
  now?: string;
  text?: string;
  generated_at?: string;
  input_digest?: string;
  error_kind?: string;
}

/** What `summarize` returns: the HTTP status (202 pending, 200 with the answer's state) and the answer. */
export type SummarizeResult = SummaryResponse & { status: number };
