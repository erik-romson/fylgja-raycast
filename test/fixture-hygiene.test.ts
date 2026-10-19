import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** The public app names fixtures may use (R12). */
export const PUBLIC_APPS = ["PyCharm", "Slack", "Safari", "Terminal", "IntelliJ IDEA", "Obsidian"];
export const SESSION_LABELS = ["claude", "codex", "opencode", "norn"];

export interface HygieneEnv {
  homedir: string;
  hostname: string;
  username: string;
}

export function currentEnv(): HygieneEnv {
  return { homedir: homedir(), hostname: hostname().split(".")[0] ?? "", username: userInfo().username };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(word)}($|[^\\p{L}\\p{N}_])`, "iu").test(text);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The violations of R12 in a parsed fixture, as `where: what` lines (never the offending value for the machine
 * checks, so a failing run does not print live data). An empty list means clean.
 */
export function checkFixture(value: unknown, env: HygieneEnv = currentEnv()): string[] {
  const problems: string[] = [];
  const walk = (node: unknown, at: string): void => {
    if (typeof node === "string") {
      if (env.homedir.length > 1 && node.includes(env.homedir)) problems.push(`${at}: contains the home directory`);
      if (node.includes("/Users/")) problems.push(`${at}: contains /Users/`);
      if (env.hostname.length >= 3 && hasWord(node, env.hostname)) problems.push(`${at}: contains the host name`);
      if (env.username.length >= 3 && hasWord(node, env.username)) problems.push(`${at}: contains the user name`);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${at}[${index}]`));
      return;
    }
    if (!isObject(node)) return;

    for (const key of ["path", "repo_root"]) {
      const v = node[key];
      if (typeof v === "string" && !v.startsWith("/work/")) problems.push(`${at}.${key}: not under /work/`);
    }
    if (Array.isArray(node.tickets)) {
      for (const ticket of node.tickets) {
        if (typeof ticket !== "string" || !/^CBS-\d+$/.test(ticket)) problems.push(`${at}.tickets: not CBS-<n>`);
      }
    }
    const isNavItem = typeof node.id === "string" && typeof node.key === "string" && typeof node.name === "string";
    if (
      isNavItem &&
      node.kind === "folder" &&
      !/^(alpha|beta|gamma|delta|epsilon)\/[A-Za-z0-9-]+$/.test(node.name as string)
    ) {
      problems.push(`${at}.name: not a neutral folder name`);
    }
    if (isNavItem && node.kind === "app" && !PUBLIC_APPS.includes(node.name as string)) {
      problems.push(`${at}.name: not a public app name`);
    }
    const isPlace = typeof node.label === "string" && typeof node.role === "string";
    if (isPlace && node.kind === "window" && !PUBLIC_APPS.includes(node.label as string)) {
      problems.push(`${at}.label: not a public app name`);
    }
    if (isPlace && node.kind === "session" && !SESSION_LABELS.includes(node.label as string)) {
      problems.push(`${at}.label: not a session label`);
    }
    for (const [key, child] of Object.entries(node)) walk(child, `${at}.${key}`);
  };
  walk(value, "$");
  return problems;
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return jsonFiles(full);
    return name.endsWith(".json") ? [full] : [];
  });
}

const FIXTURES = join(__dirname, "fixtures");

describe("fixture hygiene (R12)", () => {
  const files = jsonFiles(FIXTURES);

  it("finds the fixtures", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => relative(FIXTURES, file)))("%s is neutral", (name) => {
    const value: unknown = JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
    expect(checkFixture(value)).toEqual([]);
  });

  describe("the checker", () => {
    const env: HygieneEnv = { homedir: "/home/someone", hostname: "somebox", username: "someone" };

    it("accepts a clean sample", () => {
      const clean = {
        path: "/work/alpha/main",
        tickets: ["CBS-1"],
        items: [{ id: "1", key: "folder:/work/alpha/main", kind: "folder", name: "alpha/main" }],
        places: [{ kind: "window", role: "ide", label: "PyCharm" }],
      };
      expect(checkFixture(clean, env)).toEqual([]);
    });

    it.each([
      ["a /Users/ path", { title: "/Users/someone/x" }],
      ["the home directory", { title: "see /home/someone/x" }],
      ["the host name", { title: "on SomeBox now" }],
      ["the user name", { title: "by Someone" }],
      ["a path outside /work/", { path: "/srv/x" }],
      ["a repo_root outside /work/", { repo_root: "/srv/x" }],
      ["a bad ticket", { tickets: ["ABC-1"] }],
      ["a folder name", { id: "1", key: "k", kind: "folder", name: "me/private" }],
      ["an app name", { id: "1", key: "k", kind: "app", name: "Secret App" }],
      ["a window label", { kind: "window", role: "app", label: "Secret App" }],
      ["a session label", { kind: "session", role: "agent", label: "mine" }],
    ])("rejects %s", (_what, sample) => {
      expect(checkFixture(sample, env)).not.toEqual([]);
    });

    it("matches the user name only as a whole word", () => {
      expect(checkFixture({ title: "someones" }, env)).toEqual([]);
    });

    it("skips a short user name", () => {
      expect(checkFixture({ title: "by ab" }, { ...env, username: "ab" })).toEqual([]);
    });
  });
});
