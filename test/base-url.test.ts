import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, parseBaseUrl } from "../src/fylgja/base-url";
import { FylgjaError } from "../src/fylgja/errors";

function kindOf(pref: string | undefined): string {
  try {
    parseBaseUrl(pref);
  } catch (err) {
    expect(err).toBeInstanceOf(FylgjaError);
    return (err as FylgjaError).kind;
  }
  return "ok";
}

describe("parseBaseUrl (R3)", () => {
  it.each(["http://127.0.0.1:7319", "http://127.0.0.1:7319/", "http://127.0.0.1:7319///", " http://127.0.0.1:7319 "])(
    "accepts %j",
    (pref) => {
      expect(parseBaseUrl(pref)).toBe("http://127.0.0.1:7319");
    },
  );

  it("uses the default for an empty or missing preference", () => {
    expect(DEFAULT_BASE_URL).toBe("http://127.0.0.1:7319");
    expect(parseBaseUrl("")).toBe(DEFAULT_BASE_URL);
    expect(parseBaseUrl("   ")).toBe(DEFAULT_BASE_URL);
    expect(parseBaseUrl(undefined)).toBe(DEFAULT_BASE_URL);
  });

  it("rewrites localhost to 127.0.0.1 and keeps the port", () => {
    expect(parseBaseUrl("http://localhost:7319")).toBe("http://127.0.0.1:7319");
    expect(parseBaseUrl("http://localhost:8123/")).toBe("http://127.0.0.1:8123");
  });

  it.each([
    "localhost:7319",
    "127.0.0.1:7319",
    "https://127.0.0.1:7319",
    "http://evil.example:7319",
    "http://[::1]:7319",
    "http://u:p@127.0.0.1:7319",
    "http://127.0.0.1:7319/sub",
    "http://127.0.0.1",
    "http://127.0.0.1:7319?x=1",
    "not a url",
  ])("refuses %j with bad_base_url", (pref) => {
    expect(kindOf(pref)).toBe("bad_base_url");
  });

  it("gives the R6 message", () => {
    expect(() => parseBaseUrl("https://127.0.0.1:7319")).toThrow(
      "The Fylgja address must look like http://127.0.0.1:7319",
    );
  });
});
