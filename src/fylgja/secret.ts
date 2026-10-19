/** The API secret for POST and PATCH, read from the `secretFile` preference on every call (R5). Plain TS (R2). */

import { isAbsolute, join } from "node:path";
import { FylgjaError, messages } from "./errors";

export const DEFAULT_SECRET_FILE = "~/.config/fylgja/api-secret";

export interface SecretDeps {
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  homedir: () => string;
}

// What Python's `str.strip()` removes: the characters for which `str.isspace()` is true. Unlike JavaScript's `trim()`
// it includes U+001C-U+001F and U+0085 and excludes U+FEFF, so the client and the daemon agree on the token.
const PY_SPACE =
  "\\t\\n\\v\\f\\r\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "g");
const TOKEN = /^[\x21-\x7e]+$/;

/** `text` trimmed like Python's `str.strip()`. */
export function pyStrip(text: string): string {
  return text.replace(PY_STRIP, "");
}

/**
 * The absolute secret file path for the preference: empty means the default, a leading `~/` is the home directory,
 * nothing else is expanded. A path that is not absolute throws `no_secret`.
 */
export function secretPath(pref: string | undefined, homedir: () => string): string {
  const text = (pref ?? "").trim() || DEFAULT_SECRET_FILE;
  const path = text.startsWith("~/") ? join(homedir(), text.slice(2)) : text;
  if (!isAbsolute(path)) {
    throw new FylgjaError("no_secret", `No Fylgja API secret at ${path}: the path must be absolute`, {
      detail: "the secret file path must be absolute",
    });
  }
  return path;
}

/**
 * The secret, read now (never cached). Missing, empty or unreadable → `no_secret`; content that is not one printable
 * ASCII token without spaces → `bad_secret`. No error carries the content.
 */
export async function readSecret(pref: string | undefined, deps: SecretDeps): Promise<string> {
  const path = secretPath(pref, deps.homedir);
  let content: string;
  try {
    content = await deps.readFile(path, "utf8");
  } catch (cause) {
    // A read error names the path and the reason (ENOENT, EACCES, …), never the content.
    throw new FylgjaError("no_secret", messages.no_secret(path), { cause });
  }
  const secret = pyStrip(String(content));
  if (secret === "") throw new FylgjaError("no_secret", messages.no_secret(path));
  if (!TOKEN.test(secret)) throw new FylgjaError("bad_secret", messages.bad_secret(path));
  return secret;
}
