import { describe, expect, it } from "vitest";
import type { JournalSource } from "../src/fylgja/journal-types";
import { planOpen } from "../src/journal/open-source";

const ROOT = "/work/alpha/main";
const file = (path: string): JournalSource => ({ kind: "file", ref: path, label: "a.ts", path });

describe("planOpen", () => {
  it("opens an absolute path under the checkout", () => {
    expect(planOpen(file("/work/alpha/main/src/a.ts"), ROOT)).toEqual({ open: "/work/alpha/main/src/a.ts" });
  });

  it("joins a relative path onto the checkout", () => {
    expect(planOpen(file("src/a.ts"), ROOT)).toEqual({ open: "/work/alpha/main/src/a.ts" });
  });

  it("refuses paths outside the checkout", () => {
    const refuse = { refuse: "That file is outside the checkout" };
    expect(planOpen(file("../../etc/passwd"), ROOT)).toEqual(refuse);
    expect(planOpen(file("/etc/passwd"), ROOT)).toEqual(refuse);
    expect(planOpen(file("/work/alpha/main/../beta/a.ts"), ROOT)).toEqual(refuse);
    expect(planOpen(file("/work/alpha/main-other/a.ts"), ROOT)).toEqual(refuse);
  });

  it("refuses a path with a NUL byte", () => {
    expect(planOpen(file("src/a\0.ts"), ROOT)).toEqual({ refuse: "That file is outside the checkout" });
  });

  it("focuses a session", () => {
    expect(planOpen({ kind: "session", ref: "claude:abc", label: "claude" }, ROOT)).toEqual({ focus: "claude:abc" });
  });

  it("has no plan for other kinds", () => {
    for (const kind of ["commit", "todo", "run", "thread", "person", "unknown"]) {
      expect(planOpen({ kind, ref: "r", label: "l" }, ROOT), kind).toBeNull();
    }
  });
});
