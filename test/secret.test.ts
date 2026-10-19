import { describe, expect, it, vi } from "vitest";
import { FylgjaError } from "../src/fylgja/errors";
import { DEFAULT_SECRET_FILE, pyStrip, readSecret } from "../src/fylgja/secret";

const HOME = "/home/x";
const DEFAULT_PATH = "/home/x/.config/fylgja/api-secret";

function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: "ENOENT" });
}

/** A fake file system: `files` maps an absolute path to its content; any other path is missing. */
function deps(files: Record<string, string>) {
  return {
    readFile: vi.fn(async (path: string) => {
      if (path in files) return files[path];
      throw enoent(path);
    }),
    homedir: () => HOME,
  };
}

async function failure(promise: Promise<unknown>): Promise<FylgjaError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(FylgjaError);
    return err as FylgjaError;
  }
  throw new Error("expected a FylgjaError");
}

describe("readSecret (R5)", () => {
  it.each(["abc\n", "abc\r\n", "  abc  \n\n", "\tabc\u000b\u001c"])("trims %j to abc", async (content) => {
    await expect(readSecret("/s/secret", deps({ "/s/secret": content }))).resolves.toBe("abc");
  });

  it("trims like Python's str.strip(), keeping a byte-order mark", () => {
    expect(pyStrip("\u0085 abc　 ")).toBe("abc");
    expect(pyStrip("﻿abc")).toBe("﻿abc");
  });

  it("reports a missing file as no_secret naming the path", async () => {
    const err = await failure(readSecret("/s/missing", deps({})));
    expect(err.kind).toBe("no_secret");
    expect(err.message).toBe("No Fylgja API secret at /s/missing: run `fylgja install secret` and restart the daemon");
  });

  it.each(["", "   \n\t\r\n"])("reports content %j as no_secret naming the path", async (content) => {
    const err = await failure(readSecret("/s/secret", deps({ "/s/secret": content })));
    expect(err.kind).toBe("no_secret");
    expect(err.message).toContain("/s/secret");
  });

  it("reports an unreadable file as no_secret with the cause, never the content", async () => {
    const readFile = vi.fn(async () => {
      throw Object.assign(new Error("EACCES: permission denied, open '/s/secret'"), { code: "EACCES" });
    });
    const err = await failure(readSecret("/s/secret", { readFile, homedir: () => HOME }));
    expect(err.kind).toBe("no_secret");
    expect(err.message).toContain("/s/secret");
    expect((err.cause as { code?: string }).code).toBe("EACCES");
  });

  it.each([
    ["a newline inside", "ab\ncd"],
    ["a space inside", "ab cd"],
    ["a non-ASCII character", "abæcd"],
    ["a control character", "ab\u0007cd"],
  ])("reports %s as bad_secret without any fragment of the content", async (_label, content) => {
    const err = await failure(readSecret("/s/secret", deps({ "/s/secret": content })));
    expect(err.kind).toBe("bad_secret");
    expect(err.message).toBe("The Fylgja API secret at /s/secret is not a single-line token");
    expect(err.message).not.toContain("ab");
    expect(err.message).not.toContain("cd");
  });

  it("expands a leading ~/ to the home directory", async () => {
    const fs = deps({ [DEFAULT_PATH]: "abc" });
    await expect(readSecret("~/.config/fylgja/api-secret", fs)).resolves.toBe("abc");
    expect(fs.readFile).toHaveBeenCalledWith(DEFAULT_PATH, "utf8");
  });

  it("uses the default path for an empty preference", async () => {
    expect(DEFAULT_SECRET_FILE).toBe("~/.config/fylgja/api-secret");
    for (const pref of ["", "  ", undefined]) {
      const fs = deps({ [DEFAULT_PATH]: "abc" });
      await expect(readSecret(pref, fs)).resolves.toBe("abc");
      expect(fs.readFile).toHaveBeenCalledWith(DEFAULT_PATH, "utf8");
    }
  });

  it.each(["relative/x", "$FYLGJA_CONFIG_DIR/api-secret", "~", "~other/x"])(
    "refuses %j as not absolute, without expanding anything or reading",
    async (pref) => {
      const fs = deps({});
      const err = await failure(readSecret(pref, fs));
      expect(err.kind).toBe("no_secret");
      expect(err.message).toContain("must be absolute");
      expect(err.message).toContain(pref);
      expect(fs.readFile).not.toHaveBeenCalled();
    },
  );
});
