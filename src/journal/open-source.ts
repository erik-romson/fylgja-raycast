/** What "Open Source" does for each source kind. Plain TypeScript (R2). */
import { posix } from "node:path";
import type { JournalSource } from "../fylgja/journal-types";

export type OpenPlan = { open: string } | { refuse: string } | { focus: string };

const OUTSIDE = "That file is outside the checkout";

export function planOpen(source: JournalSource, repoRoot: string): OpenPlan | null {
  if (source.kind === "session") return { focus: source.ref };
  if (source.kind !== "file") return null;
  const path = source.path;
  if (typeof path !== "string" || path === "") return null;
  if (path.includes("\0") || repoRoot.includes("\0")) return { refuse: OUTSIDE };
  const root = posix.normalize(repoRoot);
  const resolved = posix.isAbsolute(path) ? posix.normalize(path) : posix.normalize(posix.join(root, path));
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return resolved.startsWith(prefix) ? { open: resolved } : { refuse: OUTSIDE };
}
