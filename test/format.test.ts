import { describe, expect, it } from "vitest";
import { escapeMarkdown, formatAgo, formatDuration, oneLine, truncate } from "../src/format";

process.env.TZ = "Europe/Oslo";
const NOW = Date.parse("2026-10-19T12:00:00Z");

function ago(seconds: number, suffix = "Z"): string {
  const iso = new Date(NOW - seconds * 1000).toISOString();
  return suffix === "Z" ? iso : iso.replace("Z", "123456Z");
}

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [0.6, "1s"],
    [59.4, "59s"],
    [59.6, "1m"],
    [60, "1m"],
    [3599, "59m"],
    [3600, "1h"],
    [3660, "1h 1m"],
    [5400, "1h 30m"],
    [90000, "25h"],
    [Number.NaN, "0s"],
    [-5, "0s"],
    [undefined, "0s"],
  ])("%s -> %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe("formatAgo", () => {
  it("is just now for now and the future", () => {
    expect(formatAgo(ago(0), NOW)).toBe("just now");
    expect(formatAgo(ago(-3600), NOW)).toBe("just now");
    expect(formatAgo(ago(0.5), NOW)).toBe("just now");
  });

  it("counts seconds, minutes, hours and days", () => {
    expect(formatAgo(ago(30), NOW)).toBe("30s ago");
    expect(formatAgo(ago(60), NOW)).toBe("1m ago");
    expect(formatAgo(ago(3600), NOW)).toBe("1h ago");
    expect(formatAgo(ago(86400), NOW)).toBe("1d ago");
  });

  it("parses Z and microsecond times", () => {
    expect(formatAgo("2026-10-19T11:00:00Z", NOW)).toBe("1h ago");
    expect(formatAgo("2026-10-19T11:00:00.123456Z", NOW)).toBe("59m ago");
    expect(formatAgo(ago(3600, "us"), new Date(NOW))).not.toBe("");
  });

  it("is empty for unparsable input", () => {
    expect(formatAgo("garbage", NOW)).toBe("");
    expect(formatAgo("", NOW)).toBe("");
    expect(formatAgo(undefined, NOW)).toBe("");
  });
});

describe("oneLine and truncate", () => {
  it("collapses whitespace", () => {
    expect(oneLine("a\n  b\tc")).toBe("a b c");
    expect(oneLine("  x  ")).toBe("x");
  });

  it("cuts by code points and ends with one ellipsis", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abcd", 4)).toBe("abcd");
    const out = truncate("ab😀cd", 4);
    expect(out).toBe("ab😀…");
    expect(Array.from(out)).toHaveLength(4);
    expect(truncate("a😀😀", 2)).toBe("a…");
  });
});

describe("escapeMarkdown", () => {
  it("escapes image, link, html, heading, table and code characters", () => {
    const out = escapeMarkdown("![x](http://a/b.png) `code` <b>x</b> # h | * _ [l](u)");
    expect(out).toBe("\\!\\[x\\]\\(http://a/b.png\\) \\`code\\` \\<b\\>x\\</b\\> \\# h \\| \\* \\_ \\[l\\]\\(u\\)");
    expect(out).toContain("code");
    expect(out).not.toMatch(/(^|[^\\])[`<>[\]()|#!*_]/);
  });

  it("escapes line-leading list and quote markers", () => {
    expect(escapeMarkdown("1. one")).toBe("1\\. one");
    expect(escapeMarkdown("- item")).toBe("\\- item");
    expect(escapeMarkdown("+ item")).toBe("\\+ item");
    expect(escapeMarkdown("> quote")).toBe("\\> quote");
    expect(escapeMarkdown("a\n1. b\n- c")).toBe("a\n1\\. b\n\\- c");
  });

  it("escapes the backslash and leaves plain text alone", () => {
    expect(escapeMarkdown("a\\b")).toBe("a\\\\b");
    expect(escapeMarkdown("Sentence one.")).toBe("Sentence one.");
  });
});
