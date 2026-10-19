/** The client built from the command preferences. UI side of R2: it reads `@raycast/api` preferences. */
import { getPreferenceValues } from "@raycast/api";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { parseBaseUrl } from "../fylgja/base-url";
import { createClient, type Client } from "../fylgja/client";
import { createHttp, type Http } from "../fylgja/http";
import { createJournalClient, type JournalClient } from "../fylgja/journal-client";
import { readSecret } from "../fylgja/secret";

interface DaemonPreferences {
  baseUrl?: string;
  secretFile?: string;
}

const deps = { readFile, homedir };

function createFylgjaHttp(): Http {
  const { baseUrl, secretFile } = getPreferenceValues<DaemonPreferences>();
  return createHttp({ baseUrl: parseBaseUrl(baseUrl), secretFile, fetch: (url, init) => fetch(url, init), ...deps });
}

/** The client for the current preferences. Throws `bad_base_url` before any file read or request. */
export function createFylgjaClient(): Client {
  return createClient(createFylgjaHttp());
}

/** The journal client for the current preferences. Throws `bad_base_url` before any file read or request. */
export function createFylgjaJournalClient(): JournalClient {
  return createJournalClient(createFylgjaHttp());
}

/** The parsed base URL of the current preferences (no trailing slash). Throws `bad_base_url`. */
export function currentBaseUrl(): string {
  return parseBaseUrl(getPreferenceValues<DaemonPreferences>().baseUrl);
}

/** Reads the secret from the `secretFile` preference (for `runGo`); rejects with `no_secret` or `bad_secret`. */
export async function checkSecret(): Promise<string> {
  const { secretFile } = getPreferenceValues<DaemonPreferences>();
  return readSecret(secretFile, deps);
}
