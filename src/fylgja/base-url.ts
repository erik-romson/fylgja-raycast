/** The daemon address from the `baseUrl` preference (R3). Plain TypeScript (R2). */

import { FylgjaError, messages } from "./errors";

export const DEFAULT_BASE_URL = "http://127.0.0.1:7319";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * The validated base URL, `http://127.0.0.1:<port>` without a trailing slash. Empty means the default. Anything that
 * is not `http:` on `127.0.0.1` or `localhost` with an explicit port, no user or password, and an empty or `/` path
 * throws `bad_base_url`.
 */
export function parseBaseUrl(pref: string | undefined): string {
  const text = (pref ?? "").trim();
  if (text === "") return DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw badBaseUrl();
  }
  const ok =
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.username === "" &&
    url.password === "" &&
    // `URL` drops the default port 80, so `:80` counts as no port. The daemon's Host check would refuse it anyway,
    // because `fetch` then sends `Host: 127.0.0.1` without the port.
    url.port !== "" &&
    url.search === "" &&
    url.hash === "" &&
    /^\/*$/.test(url.pathname);
  if (!ok) throw badBaseUrl();
  return `http://127.0.0.1:${url.port}`;
}

function badBaseUrl(): FylgjaError {
  return new FylgjaError("bad_base_url", messages.bad_base_url());
}
