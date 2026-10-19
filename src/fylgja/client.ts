/**
 * The typed Navigator client over the HTTP core: items, rankers, focus and summaries. Plain TypeScript (R2).
 */

import { FylgjaError, messages } from "./errors";
import type { Http, JsonObject } from "./http";
import {
  ITEMS_SCHEMA,
  RANKERS_SCHEMA,
  type FocusResult,
  type GoTarget,
  type Items,
  type Rankers,
  type SummarizeResult,
  type SummaryResponse,
} from "./types";

export interface ItemsQuery {
  rank?: string;
  q?: string;
  days?: number;
  open?: boolean;
}

export interface Client {
  getItems(query: ItemsQuery, signal?: AbortSignal): Promise<Items>;
  getRankers(rank?: string, signal?: AbortSignal): Promise<Rankers>;
  focus(target: GoTarget): Promise<FocusResult>;
  summarize(id: string): Promise<SummarizeResult>;
  getSummary(id: string, signal?: AbortSignal): Promise<SummaryResponse>;
}

const Q_MAX = 200;

export function createClient(http: Http): Client {
  return {
    async getItems(query, signal) {
      const { json } = await http.get(
        "/items",
        { rank: query.rank, q: cleanQuery(query.q), days: query.days, open: query.open },
        { signal },
      );
      checkSchema(json, ITEMS_SCHEMA, ["items", "days", "while_away"]);
      return json as unknown as Items;
    },

    async getRankers(rank, signal) {
      const { json } = await http.get("/rankers", { rank }, { signal });
      checkSchema(json, RANKERS_SCHEMA, ["choices"]);
      return json as unknown as Rankers;
    },

    async focus(target) {
      const kind: unknown = target.kind;
      if ((kind !== "window" && kind !== "session") || typeof target.ref !== "string" || target.ref === "") {
        throw new FylgjaError("bad_request", messages.bad_request("not a focus target"));
      }
      try {
        const { json } = await http.send("POST", `/focus/${kind}/${encodeURIComponent(target.ref)}`, {});
        return json as unknown as FocusResult;
      } catch (err) {
        if (err instanceof FylgjaError && err.kind === "not_found") {
          throw new FylgjaError("not_found", messages.not_found(err.detail ?? "", kind), {
            ...(err.status === undefined ? {} : { status: err.status }),
            ...(err.detail === undefined ? {} : { detail: err.detail }),
          });
        }
        throw err;
      }
    },

    async summarize(id) {
      const { status, json } = await http.send("POST", `/summaries/folder/${encodeURIComponent(id)}`, {});
      return { ...(json as unknown as SummaryResponse), status };
    },

    async getSummary(id, signal) {
      const { json } = await http.get(`/summaries/folder/${encodeURIComponent(id)}`, {}, { signal });
      return json as unknown as SummaryResponse;
    },
  };
}

/** `q` trimmed and cut to 200 code points, never inside a surrogate pair. */
function cleanQuery(q: string | undefined): string | undefined {
  if (q === undefined) return undefined;
  const points = Array.from(q.trim());
  return points.length > Q_MAX ? points.slice(0, Q_MAX).join("") : points.join("");
}

function checkSchema(json: JsonObject, expected: string, lists: string[]): void {
  const schema = json.schema;
  const seen = typeof schema === "string" ? schema : undefined;
  if (seen !== expected || lists.some((name) => !Array.isArray(json[name]))) {
    throw new FylgjaError("schema", messages.schema(expected, seen), seen === undefined ? {} : { seen });
  }
}
