/** The detail pane of a Navigator row: markdown plus metadata lines. Plain TypeScript (R2). */
import { escapeMarkdown, formatAgo, formatDuration, oneLine, truncate } from "./format";
import type { NavItem } from "./fylgja/types";
import { toRow, type AccessoryModel, type RowOptions } from "./rows";

export interface MetadataLine {
  label: string;
  text: string;
  /** Shown as colored tags instead of `text` when present. */
  tags?: AccessoryModel[];
}

export interface DetailModel {
  markdown: string;
  metadata: MetadataLine[];
}

const LINE_MAX = 200;
const NEXT_MAX = 3;

function line(label: string, text: string, max = LINE_MAX): MetadataLine {
  return { label: truncate(oneLine(label), max), text: truncate(oneLine(text), max) };
}

function para(s: string): string {
  return escapeMarkdown(s.trim());
}

function storyMarker(state: string, generatedAt: string | undefined, now: Date | number): string {
  const age = formatAgo(generatedAt, now);
  switch (state) {
    case "fresh":
      return age;
    case "stale":
      return age !== "" ? `outdated · ${age}` : "outdated";
    case "pending":
      return "updating…";
    case "failed":
      return age !== "" ? `last attempt failed · ${age}` : "last attempt failed";
    default:
      return age !== "" ? `${state.replace(/_/g, " ")} · ${age}` : state.replace(/_/g, " ");
  }
}

/** Journal first: the item, Where you are and Do next, then the story and the summary. */
function markdownOf(item: NavItem, now: Date | number): string {
  const blocks: string[] = [`## ${escapeMarkdown(oneLine(item.name))}`];

  const journal = item.journal;
  if (journal) {
    if (journal.where) blocks.push(`**Where you are**\n\n${para(journal.where)}`);
    const next = (journal.next ?? []).slice(0, NEXT_MAX);
    const more = journal.next_more ?? 0;
    if (next.length > 0 || more > 0) {
      const lines = next.map((n) => `- ${escapeMarkdown(oneLine(n.text))}`);
      if (more > 0) lines.push(`\n+${more} more in the Journal`);
      blocks.push(`**Do next**\n\n${lines.join("\n")}`);
    }
  }

  const story = item.story;
  if (story?.text) {
    let block = `**Story**\n\n${para(story.text)}`;
    const marker = storyMarker(story.state, story.generated_at, now);
    if (marker !== "") block += `\n\n*${escapeMarkdown(marker)}*`;
    blocks.push(block);
  }

  const summary = item.summary ?? "";
  if (summary.trim() !== "") blocks.push(`**Summary**\n\n${para(summary)}`);

  return blocks.join("\n\n");
}

export function buildDetail(item: NavItem, options: RowOptions): DetailModel {
  const row = toRow(item, options);
  const metadata: MetadataLine[] = [];

  // The pane replaces the row's accessories, so it carries every one of them, first, as tags.
  if (row.accessories.length > 0) {
    metadata.push({ label: "Status", text: row.accessories.map((a) => a.text).join(" · "), tags: row.accessories });
  }

  for (const place of item.places ?? []) {
    const label = oneLine(place.label);
    const title = oneLine(place.title ?? "");
    const parts: string[] = [];
    if (place.workspace) parts.push(`ws ${oneLine(place.workspace)}`);
    parts.push(place.open ? "open" : "closed");
    if (place.waiting) parts.push("waiting");
    const ago = formatAgo(place.last_focus_at, options.now);
    if (ago !== "") parts.push(ago);
    metadata.push(line(title !== "" ? `${label} — ${title}` : label, parts.join(" · ")));
  }

  const lastFocus = formatAgo(item.last_focus_at, options.now);
  const today = `${formatDuration(item.seconds_today)} today`;
  metadata.push(line("Time", lastFocus !== "" ? `${today} · last focus ${lastFocus}` : today));

  const tickets = item.tickets ?? [];
  if (tickets.length > 0) metadata.push(line("Tickets", tickets.join(", ")));
  if (item.group) metadata.push(line("Group", item.group));
  if (item.kind === "folder" && item.path) metadata.push(line("Path", item.path));
  if (item.kind === "app" && item.key.startsWith("app:")) metadata.push(line("App id", item.key.slice("app:".length)));

  return { markdown: markdownOf(item, options.now), metadata };
}
