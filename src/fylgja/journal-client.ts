/**
 * The typed journal client over the HTTP core: the focused journal, How, item patches and todos. Plain TypeScript (R2).
 */

import { FylgjaError, messages } from "./errors";
import type { Http, JsonObject } from "./http";
import {
  JOURNAL_SCHEMA,
  type FocusedJournal,
  type ItemPatch,
  type JournalHow,
  type JournalThread,
} from "./journal-types";

export interface JournalClient {
  getFocusedJournal(signal?: AbortSignal, options?: { timeoutMs?: number }): Promise<FocusedJournal>;
  requestHow(id: string): Promise<JournalHow>;
  getHow(id: string, signal?: AbortSignal): Promise<JournalHow>;
  patchItem(id: string, patch: ItemPatch): Promise<void>;
  makeTodo(id: string): Promise<{ created: boolean }>;
}

const EMPTY_DETAILS = new Set(["nothing is focused", "no journal for this checkout"]);
const PATCH_KEYS = new Set(["status", "pinned"]);

export function createJournalClient(http: Http): JournalClient {
  return {
    async getFocusedJournal(signal, options = {}) {
      let json: JsonObject;
      try {
        ({ json } = await http.get("/journal/focused", {}, { signal, timeoutMs: options.timeoutMs }));
      } catch (err) {
        if (err instanceof FylgjaError) {
          if (err.kind === "journal_off") return { kind: "off" };
          if (err.kind === "not_found" && err.detail !== undefined && EMPTY_DETAILS.has(err.detail)) {
            return { kind: "empty", detail: err.detail };
          }
        }
        throw err;
      }
      const seen = typeof json.schema === "string" ? json.schema : undefined;
      if (seen !== JOURNAL_SCHEMA) {
        throw new FylgjaError("schema", messages.schema(JOURNAL_SCHEMA, seen), seen === undefined ? {} : { seen });
      }
      return { kind: "thread", thread: json as unknown as JournalThread };
    },

    async requestHow(id) {
      const { json } = await http.send("POST", `/journal/items/${encodeURIComponent(id)}/how`, {});
      return json as unknown as JournalHow;
    },

    async getHow(id, signal) {
      const { json } = await http.get(`/journal/items/${encodeURIComponent(id)}/how`, {}, { signal });
      return json as unknown as JournalHow;
    },

    async patchItem(id, patch) {
      const body: Record<string, unknown> = {};
      const entries = Object.entries(patch as Record<string, unknown>);
      if (entries.length === 0) {
        throw new FylgjaError("bad_request", messages.bad_request("an empty journal patch"));
      }
      for (const [key, value] of entries) {
        if (!PATCH_KEYS.has(key)) {
          throw new FylgjaError("bad_request", messages.bad_request(`unknown journal patch key ${key}`));
        }
        if (value === undefined || value === null) {
          throw new FylgjaError("bad_request", messages.bad_request(`journal patch ${key} has no value`));
        }
        body[key] = value;
      }
      await http.send("PATCH", `/journal/items/${encodeURIComponent(id)}`, body);
    },

    async makeTodo(id) {
      const { status } = await http.send("POST", `/journal/items/${encodeURIComponent(id)}/todo`, {});
      return { created: status === 201 };
    },
  };
}
