import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

// The one place that lists the commands.
const EXPECTED_COMMANDS = ["navigate", "journal", "journal-menubar"];

interface Preference {
  name: string;
  type: string;
  title?: string;
  description?: string;
  label?: string;
  default?: unknown;
  required?: boolean;
  data?: { title: string; value: string }[];
}

interface Command {
  name: string;
  title: string;
  description: string;
  mode: string;
  interval?: string;
  preferences?: Preference[];
}

interface Manifest {
  name: string;
  license: string;
  icon: string;
  commands: Command[];
  preferences: Preference[];
  [key: string]: unknown;
}

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Manifest;

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

const RAYCAST_MODULE = String.raw`@raycast/(?:api|utils)`;
const QUOTED = String.raw`["']${RAYCAST_MODULE}(?:/[^"']*)?["']`;
// Anchored at the start of a line, so a sample inside a string is not a finding.
const RUNTIME_IMPORT_PATTERNS = [
  new RegExp(String.raw`^\s*import\s+(?!type\b)[^;]*?\sfrom\s*${QUOTED}`, "m"),
  new RegExp(String.raw`^\s*import\s+${QUOTED}`, "m"),
  new RegExp(String.raw`^\s*export\s+(?!type\b)[^;]*?\sfrom\s*${QUOTED}`, "m"),
  new RegExp(String.raw`^[^\n]*\brequire\(\s*${QUOTED}\s*\)`, "m"),
  new RegExp(String.raw`^[^\n]*\bimport\(\s*${QUOTED}\s*\)`, "m"),
];

/** Reports the runtime imports of `@raycast/api` or `@raycast/utils` in `source` (`import type` passes). */
export function findRuntimeRaycastImports(source: string): string[] {
  const findings: string[] = [];
  for (const pattern of RUNTIME_IMPORT_PATTERNS) {
    const match = pattern.exec(source);
    if (match) findings.push(match[0].trim());
  }
  return findings;
}

describe("package.json", () => {
  it("is the private Fylgja extension", () => {
    expect(manifest.name).toBe("fylgja");
    expect(manifest.license).toBe("MIT");
    expect("owner" in manifest).toBe(false);
  });

  it("has a 512x512 PNG icon in assets/", () => {
    const path = join(root, "assets", manifest.icon);
    expect(existsSync(path)).toBe(true);
    const bytes = readFileSync(path);
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(bytes.readUInt32BE(16)).toBe(512);
    expect(bytes.readUInt32BE(20)).toBe(512);
  });
});

describe("commands", () => {
  it("are the three commands", () => {
    expect(manifest.commands.map((c) => c.name)).toEqual(EXPECTED_COMMANDS);
  });

  it("registers the journal menu bar command with mode menu-bar and interval 1m", () => {
    const command = manifest.commands.find((c) => c.name === "journal-menubar");
    expect(command?.title).toBe("Fylgja Journal in Menu Bar");
    expect(command?.mode).toBe("menu-bar");
    expect(command?.interval).toBe("1m");
    expect(command?.description.length).toBeGreaterThanOrEqual(12);
  });

  it("each have a mode and a source file", () => {
    for (const command of manifest.commands) {
      expect(["view", "no-view", "menu-bar"]).toContain(command.mode);
      expect(existsSync(join(root, "src", `${command.name}.tsx`))).toBe(true);
    }
  });
});

describe("preferences", () => {
  it("has the extension-level preferences", () => {
    const prefs = manifest.preferences.map(({ name, type, default: value, required }) => ({
      name,
      type,
      default: value,
      required,
    }));
    expect(prefs).toEqual([
      { name: "baseUrl", type: "textfield", default: "http://127.0.0.1:7319", required: false },
      { name: "secretFile", type: "textfield", default: "~/.config/fylgja/api-secret", required: false },
    ]);
  });

  it("has the navigate preferences", () => {
    const navigate = manifest.commands.find((c) => c.name === "navigate");
    const prefs = navigate?.preferences ?? [];
    expect(prefs.map((p) => p.name)).toEqual(["defaultRanker", "days", "onlyOpen", "groupByDay"]);
    const byName = Object.fromEntries(prefs.map((p) => [p.name, p]));
    expect(byName.defaultRanker).toMatchObject({ type: "textfield", default: "", required: false });
    expect(byName.days).toMatchObject({ type: "dropdown", default: "14", required: false });
    expect(byName.days.data?.map((d) => d.value)).toEqual(["1", "3", "7", "14"]);
    expect(byName.onlyOpen).toMatchObject({
      type: "checkbox",
      label: "Only items with something open",
      default: true,
      required: false,
    });
    expect(byName.groupByDay).toMatchObject({
      type: "checkbox",
      label: "Group by day",
      default: false,
      required: false,
    });
  });

  it("gives every preference a title and a description of 8+ characters", () => {
    const all = [...manifest.preferences, ...manifest.commands.flatMap((c) => c.preferences ?? [])];
    for (const pref of all) {
      expect(pref.title, pref.name).toBeTruthy();
      expect((pref.description ?? "").length, pref.name).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("purity guard (R2)", () => {
  it("flags runtime imports and passes type imports", () => {
    const mod = ["@raycast", "api"].join("/");
    const utils = ["@raycast", "utils"].join("/");
    expect(findRuntimeRaycastImports(`import { List } from "${mod}";`)).toHaveLength(1);
    expect(findRuntimeRaycastImports(`import type { List } from "${mod}";`)).toEqual([]);
    expect(findRuntimeRaycastImports(`import "${mod}";`)).toHaveLength(1);
    expect(findRuntimeRaycastImports(`const a = require("${utils}");`)).toHaveLength(1);
    expect(findRuntimeRaycastImports(`const a = await import("${utils}");`)).toHaveLength(1);
    expect(findRuntimeRaycastImports(`import { useFetch } from '${utils}';`)).toHaveLength(1);
    expect(findRuntimeRaycastImports(`import fs from "node:fs";`)).toEqual([]);
  });

  it("finds no runtime Raycast import outside src/ui and the UI entry points", () => {
    const uiFiles = ["navigate", "journal", "journal-menubar"].map((n) => join(root, "src", `${n}.tsx`));
    const sources = listFiles(join(root, "src")).filter(
      (f) =>
        /\.tsx?$/.test(f) && f.endsWith(".ts") && !f.startsWith(join(root, "src", "ui") + sep) && !uiFiles.includes(f),
    );
    const tests = listFiles(join(root, "test")).filter((f) => /\.tsx?$/.test(f));
    const offenders = [...sources, ...tests]
      .map((file) => ({ file: relative(root, file), found: findRuntimeRaycastImports(readFileSync(file, "utf8")) }))
      .filter((r) => r.found.length > 0);
    expect(offenders).toEqual([]);
  });
});

describe(".gitignore", () => {
  it("lists the build output", () => {
    const lines = readFileSync(join(root, ".gitignore"), "utf8").split("\n");
    for (const entry of ["/node_modules", "/dist", "raycast-env.d.ts", "/tmp/"]) {
      expect(lines).toContain(entry);
    }
  });
});
