/** Icon descriptors for the Navigator rows. Plain TypeScript (R2): the installed applications are injected. */
import type { GoTarget, ItemPlace, NavItem } from "./fylgja/types";

/** The part of Raycast's `Application` this module needs. */
export interface AppInfo {
  name: string;
  localizedName?: string;
  path: string;
  bundleId?: string;
}

export type BuiltinIconName = "Folder" | "AppWindow" | "Stars" | "Code" | "Terminal" | "Cog";

export type IconDescriptor = { type: "builtin"; name: BuiltinIconName } | { type: "file"; path: string };

export type AppIndex = ReadonlyMap<string, AppInfo>;

const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const SESSION_ICONS: Record<string, BuiltinIconName> = {
  claude: "Stars",
  codex: "Code",
  opencode: "Terminal",
  norn: "Cog",
};

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Lower-cased trimmed `name` and `localizedName`, plus `bundleId`, to the app. The lowest `path` wins a duplicate. */
export function buildAppIndex(applications: readonly AppInfo[]): AppIndex {
  const index = new Map<string, AppInfo>();
  const add = (key: string, app: AppInfo) => {
    if (key === "") return;
    const known = index.get(key);
    if (known === undefined || app.path < known.path) index.set(key, app);
  };
  for (const app of applications) {
    add(nameKey(app.name), app);
    if (app.localizedName) add(nameKey(app.localizedName), app);
    if (app.bundleId) add(nameKey(app.bundleId), app);
  }
  return index;
}

function sameTarget(place: ItemPlace, target: GoTarget): boolean {
  return place.kind === target.kind && place.ref === target.ref;
}

export function iconFor(item: NavItem, index: AppIndex): IconDescriptor {
  const places = item.places ?? [];
  const place = (item.go ? places.find((p) => sameTarget(p, item.go!)) : undefined) ?? places[0];

  if (place?.kind === "session") {
    return { type: "builtin", name: SESSION_ICONS[place.label.trim().toLowerCase()] ?? "Terminal" };
  }

  const isApp = item.kind === "app";
  const keyApp = isApp && item.key.startsWith("app:") ? item.key.slice("app:".length) : "";
  const candidates: string[] = [];
  if (BUNDLE_ID.test(keyApp)) candidates.push(keyApp);
  if (place) candidates.push(place.label);
  if (isApp) candidates.push(keyApp, item.name);
  for (const candidate of candidates) {
    const app = index.get(nameKey(candidate));
    if (app) return { type: "file", path: app.path };
  }

  return { type: "builtin", name: item.kind === "folder" ? "Folder" : "AppWindow" };
}
