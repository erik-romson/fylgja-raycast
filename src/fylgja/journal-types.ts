/** The `fylgja.journal/1` types the journal client is written against (R8). Plain TypeScript (R2). */

export const JOURNAL_SCHEMA = "fylgja.journal/1";

/** A union of the known values plus any other string, so an unknown value still type-checks and renders (R8). */
type Known<T extends string> = T | (string & {});

export type WhereState = Known<"pending" | "failed" | "fresh" | "missing">;
export type SourceKind = Known<"session" | "run" | "commit" | "todo" | "file" | "thread" | "person">;
export type HowState = Known<"fresh" | "stale" | "pending" | "failed" | "missing">;
export type ItemKind = Known<"next" | "remember" | "blocked">;
export type ItemStatus = Known<"open" | "done" | "dropped">;

export interface JournalWhere {
  state: WhereState;
  text?: string;
  generated_at?: string;
}

/** The newest recap a session of the checkout wrote (Claude Code's `away_summary`). */
export interface JournalRecap {
  text: string;
  at: string;
  /** The session key. */
  session: string;
}

export interface JournalSource {
  kind: SourceKind;
  ref: string;
  label: string;
  /** Set for a `file` source. */
  path?: string;
  section?: string;
}

export interface JournalItem {
  id: string;
  kind: ItemKind;
  text: string;
  status: ItemStatus;
  pinned: boolean;
  /** Among the first three open items of its kind. */
  shown: boolean;
  source: JournalSource;
  created_at: string;
  closed_at?: string;
  closed_by?: Known<"model" | "user" | "fylgja">;
  todo_id?: string;
  has_how: boolean;
}

export interface DoneDay {
  /** `YYYY-MM-DD`, local time. */
  day: string;
  relative?: Known<"today" | "yesterday">;
  headlines: string[];
  items: JournalItem[];
}

export interface JournalOpen {
  next: JournalItem[];
  remember: JournalItem[];
  blocked: JournalItem[];
}

export interface JournalThread {
  schema: typeof JOURNAL_SCHEMA;
  enabled: boolean;
  id: string;
  name: string;
  folder: string;
  branch: string;
  repo_root: string;
  last_at?: string;
  where: JournalWhere;
  /** Absent while no session of the checkout wrote one. */
  recap?: JournalRecap;
  open: JournalOpen;
  done_recent: DoneDay[];
  entries: unknown[];
  error_kind?: string;
  error_at?: string;
}

export interface JournalHow {
  item: string;
  state: HowState;
  steps?: string[];
  generated_at?: string;
  error_kind?: string;
}

/** What `getFocusedJournal` answers: a thread, an empty 404 (with the daemon's detail), or the journal being off. */
export type FocusedJournal =
  { kind: "thread"; thread: JournalThread } | { kind: "empty"; detail: string } | { kind: "off" };

export interface ItemPatch {
  status?: "open" | "done" | "dropped";
  pinned?: boolean;
}
