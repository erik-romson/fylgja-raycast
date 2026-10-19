import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createClient } from "../src/fylgja/client";
import { FylgjaError } from "../src/fylgja/errors";
import { createHttp } from "../src/fylgja/http";
import type { Rankers } from "../src/fylgja/types";
import {
  afterRankers,
  dropdownChange,
  dropdownValue,
  effectiveRank,
  isUnknownRank422,
  planRankRetry,
  rankerOptions,
  tooltipFor,
} from "../src/rankers";

const FIXTURES = join(__dirname, "fixtures");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function load(name: string): Rankers {
  return JSON.parse(fixture(name)) as Rankers;
}

const rankers = load("rankers.json");
const natural = load("rankers-natural.json");
const empty = load("rankers-empty.json");

const UNKNOWN_RANK = "rank must name a loaded ranker (frecency, recent, workspace) or the natural floor";

function json(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A client over a fake `fetch` that answers with `answer` and records each `/items` URL. */
function setup(answer: (url: URL) => Response) {
  const calls: URL[] = [];
  const fetch = vi.fn(async (url: string) => {
    const parsed = new URL(url);
    calls.push(parsed);
    return answer(parsed);
  });
  const http = createHttp({
    baseUrl: "http://127.0.0.1:7319",
    secretFile: "/s/api-secret",
    fetch,
    readFile: async () => "abc\n",
    homedir: () => "/home/x",
  });
  return { client: createClient(http), calls };
}

/** The error the client raises for one daemon answer. */
async function errorFor(status: number, body: unknown): Promise<FylgjaError> {
  const { client } = setup(() => json(status, body));
  try {
    await client.getItems({ rank: "gone" });
  } catch (err) {
    expect(err).toBeInstanceOf(FylgjaError);
    return err as FylgjaError;
  }
  throw new Error("expected a FylgjaError");
}

describe("rankerOptions", () => {
  it("lists the choices in order, the default as the empty value", () => {
    expect(rankerOptions(rankers)).toEqual([
      { value: "", title: "frecency (default)", description: "Focus on working time, decayed" },
      { value: "recent", title: "recent", description: "Most recently focused first" },
      { value: "workspace", title: "workspace", description: "Workspace number order" },
    ]);
  });

  it("puts the default where the daemon sends it", () => {
    const answer: Rankers = {
      ...rankers,
      choices: [
        { name: "recent", default: false },
        { name: "frecency", default: true },
      ],
    };
    expect(rankerOptions(answer).map((o) => [o.value, o.title])).toEqual([
      ["recent", "recent"],
      ["", "frecency (default)"],
    ]);
  });

  it("adds a first fallback option when no choice is the default", () => {
    const options = rankerOptions(natural);
    expect(options[0]).toEqual({ value: "", title: "natural (fallback)" });
    expect(options.slice(1).map((o) => o.value)).toEqual(["recent", "workspace"]);
  });

  it("offers only the fallback option for no choices", () => {
    expect(rankerOptions(empty)).toEqual([{ value: "", title: "natural (fallback)" }]);
  });

  it("names the fallback from the answer, not a constant", () => {
    expect(rankerOptions({ default: "floor", choices: [] })).toEqual([{ value: "", title: "floor (fallback)" }]);
  });

  it("offers only the empty option without an answer", () => {
    expect(rankerOptions(undefined)).toEqual([{ value: "", title: "Default" }]);
  });

  it("treats a null choices list as empty", () => {
    const answer = { ...empty, choices: null } as unknown as Rankers;
    expect(rankerOptions(answer)).toEqual([{ value: "", title: "natural (fallback)" }]);
  });

  it("keeps a daemon name as the value and flattens it for the title", () => {
    const answer: Rankers = {
      ...rankers,
      choices: [{ name: "two\nlines", description: "a\tb", default: false }],
    };
    expect(rankerOptions(answer)[1]).toEqual({ value: "two\nlines", title: "two lines", description: "a b" });
  });
});

describe("effectiveRank", () => {
  it("uses the trimmed preference while nothing is stored", () => {
    expect(effectiveRank(null, " recent ")).toBe("recent");
    expect(effectiveRank(null, "")).toBe("");
  });

  it("prefers the stored choice, the empty default included", () => {
    expect(effectiveRank("", "recent")).toBe("");
    expect(effectiveRank("workspace", "recent")).toBe("workspace");
  });
});

describe("afterRankers", () => {
  it("clears a stored choice the daemon calls stale", () => {
    expect(afterRankers("gone", "", { ...rankers, stale_choice: true })).toEqual({
      storedNext: null,
      prefUsable: true,
    });
  });

  it("keeps a stored choice that is not stale", () => {
    expect(afterRankers("recent", "", rankers).storedNext).toBe("recent");
    expect(afterRankers("", "", rankers).storedNext).toBe("");
  });

  it("does not store anything when the stale rank came from the preference", () => {
    expect(afterRankers(null, "gone2", { ...rankers, stale_choice: true })).toEqual({
      storedNext: null,
      prefUsable: false,
    });
  });

  it("drops a preference that names no choice", () => {
    expect(afterRankers(null, "gone2", rankers).prefUsable).toBe(false);
    expect(afterRankers(null, "natural", rankers).prefUsable).toBe(false);
    expect(afterRankers(null, "Recent", rankers).prefUsable).toBe(false);
  });

  it("keeps an empty preference or one that names a choice", () => {
    expect(afterRankers(null, "", rankers).prefUsable).toBe(true);
    expect(afterRankers(null, " recent ", rankers).prefUsable).toBe(true);
    expect(afterRankers(null, "frecency", rankers).prefUsable).toBe(true);
  });

  it("never stores natural", () => {
    expect(afterRankers("natural", "", { ...natural, stale_choice: true }).storedNext).toBeNull();
  });
});

describe("isUnknownRank422", () => {
  it("holds for the daemon's unknown-ranker 422 on a ranked request", async () => {
    const error = await errorFor(422, { detail: UNKNOWN_RANK });
    expect(error.kind).toBe("unprocessable");
    expect(isUnknownRank422(error, "gone")).toBe(true);
  });

  it("does not hold for a request without a rank", async () => {
    expect(isUnknownRank422(await errorFor(422, { detail: UNKNOWN_RANK }), "")).toBe(false);
  });

  it("does not hold for another 422", async () => {
    expect(isUnknownRank422(await errorFor(422, { detail: "q may be at most 200 characters" }), "gone")).toBe(false);
  });

  it("does not hold for a 422 array detail", async () => {
    const body = {
      detail: [
        {
          type: "less_than_equal",
          loc: ["query", "days"],
          msg: "Input should be less than or equal to 14",
          input: "99",
        },
      ],
    };
    expect(isUnknownRank422(await errorFor(422, body), "gone")).toBe(false);
  });

  it("does not hold for other kinds or values", () => {
    const conflict = new FylgjaError("conflict", UNKNOWN_RANK, { status: 409, detail: UNKNOWN_RANK });
    expect(isUnknownRank422(conflict, "gone")).toBe(false);
    expect(isUnknownRank422(new Error(UNKNOWN_RANK), "gone")).toBe(false);
    expect(isUnknownRank422(undefined, "gone")).toBe(false);
  });
});

describe("planRankRetry", () => {
  it("refetches once without the rank, then stops", async () => {
    const unknown = await errorFor(422, { detail: UNKNOWN_RANK });
    expect(planRankRetry(0, unknown, "gone")).toBe(true);
    expect(planRankRetry(1, unknown, "gone")).toBe(false);
    expect(planRankRetry(0, unknown, "")).toBe(false);
    expect(planRankRetry(0, await errorFor(422, { detail: "q may be at most 200 characters" }), "gone")).toBe(false);
    expect(planRankRetry(0, await errorFor(503, { detail: "busy" }), "gone")).toBe(false);
  });

  /** The navigator's refetch loop: send the rank, and on a planned retry send none. */
  async function drive(answer: (url: URL) => Response, firstRank: string) {
    const { client, calls } = setup(answer);
    let rank = firstRank;
    let attempts = 0;
    for (;;) {
      try {
        return { result: await client.getItems({ rank: rank === "" ? undefined : rank }), calls };
      } catch (err) {
        if (!planRankRetry(attempts, err, rank)) return { error: err, calls };
        attempts += 1;
        rank = "";
      }
    }
  }

  it("makes exactly two calls when the daemon keeps refusing", async () => {
    const { error, calls } = await drive(() => json(422, { detail: UNKNOWN_RANK }), "gone");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.searchParams.get("rank")).toBe("gone");
    expect(calls[1]!.searchParams.has("rank")).toBe(false);
    expect(error).toBeInstanceOf(FylgjaError);
    expect((error as FylgjaError).kind).toBe("unprocessable");
  });

  it("shows the list of the refetch without the rank", async () => {
    const { result, calls } = await drive(
      (url) => (url.searchParams.has("rank") ? json(422, { detail: UNKNOWN_RANK }) : json(200, fixture("items.json"))),
      "gone",
    );
    expect(calls).toHaveLength(2);
    expect(result?.schema).toBe("fylgja.items/1");
  });

  it("does not refetch an unranked request", async () => {
    const { calls } = await drive(() => json(422, { detail: UNKNOWN_RANK }), "");
    expect(calls).toHaveLength(1);
  });
});

describe("dropdownChange", () => {
  it("writes only a real change", () => {
    expect(dropdownChange("", "")).toBeNull();
    expect(dropdownChange("recent", "recent")).toBeNull();
    expect(dropdownChange("", "recent")).toBe("recent");
    expect(dropdownChange("recent", "")).toBe("");
  });
});

describe("dropdownValue", () => {
  it("shows the effective rank when it is an option, else the default", () => {
    const options = rankerOptions(rankers);
    expect(dropdownValue(options, "recent")).toBe("recent");
    expect(dropdownValue(options, "")).toBe("");
    expect(dropdownValue(options, "frecency")).toBe("");
    expect(dropdownValue(options, "gone")).toBe("");
    expect(dropdownValue(rankerOptions(undefined), "recent")).toBe("");
  });
});

describe("tooltipFor", () => {
  it("is the selected option's description", () => {
    const options = rankerOptions(rankers);
    expect(tooltipFor(options, "")).toBe("Focus on working time, decayed");
    expect(tooltipFor(options, "workspace")).toBe("Workspace number order");
  });

  it("is Ranker without a description or a match", () => {
    expect(tooltipFor(rankerOptions(natural), "")).toBe("Ranker");
    expect(tooltipFor(rankerOptions(rankers), "gone")).toBe("Ranker");
  });
});
