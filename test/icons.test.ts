import { describe, expect, it } from "vitest";
import type { ItemPlace, NavItem } from "../src/fylgja/types";
import { buildAppIndex, iconFor, type AppInfo } from "../src/icons";

const place = (extra: Partial<ItemPlace> = {}): ItemPlace => ({
  kind: "window",
  ref: "100",
  role: "ide",
  label: "PyCharm",
  open: true,
  waiting: false,
  ...extra,
});

function item(extra: Partial<NavItem> = {}): NavItem {
  return {
    id: "x1",
    key: "folder:/work/x",
    kind: "folder",
    name: "alpha/main",
    tickets: [],
    score: 1,
    explanation: "",
    parts: [],
    places: [place()],
    state: [],
    seconds_today: 0,
    summary: "",
    ...extra,
  };
}

const pycharm: AppInfo = {
  name: "PyCharm",
  localizedName: "PyCharm Local",
  path: "/Applications/PyCharm.app",
  bundleId: "com.jetbrains.pycharm",
};
const slack: AppInfo = { name: "Slack", path: "/Applications/Slack.app", bundleId: "com.example.slack" };
const index = buildAppIndex([pycharm, slack]);

describe("iconFor", () => {
  it("matches the place label by name, ignoring case and spaces", () => {
    for (const label of ["PyCharm", "pycharm", " PyCharm "]) {
      expect(iconFor(item({ places: [place({ label })] }), index)).toEqual({ type: "file", path: pycharm.path });
    }
  });

  it("matches localizedName too", () => {
    expect(iconFor(item({ places: [place({ label: "PyCharm Local" })] }), index)).toEqual({
      type: "file",
      path: pycharm.path,
    });
  });

  it("takes the go place before the first place", () => {
    const places = [place({ ref: "1", label: "Slack" }), place({ ref: "2", label: "PyCharm" })];
    expect(iconFor(item({ places, go: { kind: "window", ref: "2" } }), index)).toEqual({
      type: "file",
      path: pycharm.path,
    });
    expect(iconFor(item({ places }), index)).toEqual({ type: "file", path: slack.path });
  });

  it("lets the lowest path win a duplicate name, the same on every call", () => {
    const a: AppInfo = { name: "Twin", path: "/Applications/B/Twin.app" };
    const b: AppInfo = { name: "Twin", path: "/Applications/A/Twin.app" };
    const it = item({ places: [place({ label: "Twin" })] });
    for (const list of [
      [a, b],
      [b, a],
    ]) {
      const idx = buildAppIndex(list);
      expect(iconFor(it, idx)).toEqual({ type: "file", path: b.path });
      expect(iconFor(it, idx)).toEqual({ type: "file", path: b.path });
    }
  });

  it("falls back to AppWindow for an app item and Folder for a folder item", () => {
    const label = "qemu-system-aarch64";
    expect(iconFor(item({ kind: "app", key: `app:${label}`, name: label, places: [place({ label })] }), index)).toEqual(
      {
        type: "builtin",
        name: "AppWindow",
      },
    );
    expect(iconFor(item({ places: [place({ label })] }), index)).toEqual({ type: "builtin", name: "Folder" });
  });

  it("maps agent places to a built-in icon per session kind", () => {
    const agent = (label: string) =>
      iconFor(
        item({
          places: [place({ kind: "session", ref: "s:1", role: "agent", label })],
          go: { kind: "session", ref: "s:1" },
        }),
        index,
      );
    expect(agent("claude")).toEqual({ type: "builtin", name: "Stars" });
    expect(agent("codex")).toEqual({ type: "builtin", name: "Code" });
    expect(agent("opencode")).toEqual({ type: "builtin", name: "Terminal" });
    expect(agent("norn")).toEqual({ type: "builtin", name: "Cog" });
    expect(agent("something-new")).toEqual({ type: "builtin", name: "Terminal" });
  });

  it("matches an app item by bundle id first, then by name", () => {
    const byId = item({ kind: "app", key: "app:com.jetbrains.pycharm", name: "Other", places: [] });
    expect(iconFor(byId, index)).toEqual({ type: "file", path: pycharm.path });
    const byName = item({ kind: "app", key: "app:Slack", name: "Slack", places: [] });
    expect(iconFor(byName, index)).toEqual({ type: "file", path: slack.path });
  });

  it("uses fallbacks only for an empty application list", () => {
    const empty = buildAppIndex([]);
    expect(iconFor(item(), empty)).toEqual({ type: "builtin", name: "Folder" });
    expect(iconFor(item({ kind: "app", key: "app:com.example.x", places: [] }), empty)).toEqual({
      type: "builtin",
      name: "AppWindow",
    });
  });
});
