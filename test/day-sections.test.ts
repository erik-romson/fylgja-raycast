import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FylgjaError } from "../src/fylgja/errors";
import type { Items } from "../src/fylgja/types";
import { dayLabel } from "../src/format";
import { daySections } from "../src/rows";

function fixture(name: string): Items {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8")) as Items;
}

const originalTz = process.env.TZ;
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe.each(["Europe/Oslo", "America/Los_Angeles"])("dayLabel in %s", (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });

  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

  it("labels today and yesterday", () => {
    const now = at(2026, 10, 19);
    expect(dayLabel("2026-10-19", now)).toBe("Today");
    expect(dayLabel("2026-10-18", now)).toBe("Yesterday");
  });

  it("calls the day before Yesterday across the 25-hour day", () => {
    expect(dayLabel("2026-10-25", at(2026, 10, 26))).toBe("Yesterday");
  });

  it("calls the day before Yesterday across the 23-hour day", () => {
    expect(dayLabel("2026-03-29", at(2026, 3, 30))).toBe("Yesterday");
  });

  it("calls the day before Yesterday across a year end", () => {
    expect(dayLabel("2025-12-31", at(2026, 1, 1))).toBe("Yesterday");
  });

  it("uses a late-night now by its local date", () => {
    const now = new Date(2026, 9, 19, 23, 59, 0);
    expect(dayLabel("2026-10-19", now)).toBe("Today");
    expect(dayLabel("2026-10-18", now)).toBe("Yesterday");
  });

  it("gives weekday and date for 2-6 days back", () => {
    const now = at(2026, 10, 19);
    expect(dayLabel("2026-10-16", now)).toBe("Fri 16 Oct");
    expect(dayLabel("2026-10-17", now)).toBe("Sat 17 Oct");
    expect(dayLabel("2026-10-13", now)).toBe("Tue 13 Oct");
  });

  it("gives the date for older and future days", () => {
    const now = at(2026, 10, 19);
    expect(dayLabel("2026-10-12", now)).toBe("12 Oct 2026");
    expect(dayLabel("2026-10-20", now)).toBe("20 Oct 2026");
    expect(dayLabel("2025-01-05", now)).toBe("5 Jan 2025");
  });

  it("returns a string that is not a day as is", () => {
    const now = at(2026, 10, 19);
    expect(dayLabel("garbage", now)).toBe("garbage");
    expect(dayLabel("2026-13-40", now)).toBe("2026-13-40");
    expect(dayLabel("", now)).toBe("");
  });
});

describe("daySections", () => {
  const now = new Date(2026, 9, 6, 12, 0, 0);

  it.each(["items", "items-edge"])("groups %s in the order sent", (name) => {
    const answer = fixture(name);
    const result = daySections(answer, now);
    expect("sections" in result).toBe(true);
    if (!("sections" in result)) return;
    expect(result.sections).toHaveLength(answer.days.length);
    result.sections.forEach((section, i) => {
      expect(section.title).toBe(dayLabel(answer.days[i].day, now));
      expect(section.items.map((item) => item.id)).toEqual(answer.days[i].items);
    });
    const ids = result.sections.flatMap((s) => s.items.map((item) => item.id));
    expect(ids.slice().sort()).toEqual(answer.items.map((item) => item.id).sort());
  });

  it("gives no sections and no error for an empty answer", () => {
    expect(daySections(fixture("items-empty"), now)).toEqual({ sections: [] });
  });

  function failure(answer: Items): FylgjaError {
    const result = daySections(answer, now);
    expect("sections" in result).toBe(false);
    if (!("error" in result)) throw new Error("expected an error");
    expect(result.error).toBeInstanceOf(FylgjaError);
    expect(result.error.kind).toBe("contract");
    for (const item of answer.items) expect(result.error.message).not.toContain(item.id);
    return result.error;
  }

  it("rejects an id missing from items[]", () => {
    const answer = fixture("items");
    answer.days[0].items[0] = "ghost-id";
    expect(failure(answer).message).toBe("Fylgja's day groups do not match its items (unknown item in day 2026-10-05)");
  });

  it("rejects an id repeated within one day", () => {
    const answer = fixture("items");
    answer.days[0].items.push(answer.days[0].items[0]);
    expect(failure(answer).message).toBe("Fylgja's day groups do not match its items (item listed twice)");
  });

  it("rejects an id repeated across two days", () => {
    const answer = fixture("items");
    answer.days[1].items.push(answer.days[0].items[0]);
    expect(failure(answer).message).toBe("Fylgja's day groups do not match its items (item listed twice)");
  });

  it("rejects an item in no day", () => {
    const answer = fixture("items");
    answer.days[0].items.pop();
    expect(failure(answer).message).toBe("Fylgja's day groups do not match its items (item in no day)");
  });

  it("rejects an empty day", () => {
    const answer = fixture("items");
    answer.days.push({ day: "2026-10-02", items: [] });
    expect(failure(answer).message).toBe("Fylgja's day groups do not match its items (empty day 2026-10-02)");
  });

  it("rejects a day that appears twice", () => {
    const answer = fixture("items");
    answer.days[1].day = answer.days[0].day;
    expect(failure(answer).message).toBe("Fylgja's day groups do not match its items (day 2026-10-05 twice)");
  });

  it("rejects days: [] while items[] is not empty", () => {
    const answer = fixture("items");
    answer.days = [];
    expect(failure(answer).message).toBe("Fylgja's day groups do not match its items (item in no day)");
  });
});
