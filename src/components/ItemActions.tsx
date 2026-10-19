import { Action, ActionPanel, Icon } from "@raycast/api";
import type { GoTarget, NavItem } from "../fylgja/types";
import { itemActions, type ItemActionDescriptor } from "../item-actions";
import { toShortcut } from "../ui/icons-map";

interface Props {
  item: NavItem;
  go: (target: GoTarget | undefined, item: NavItem) => unknown;
  onToggleDetails: () => void;
  onRefresh: () => void;
  /** The answer's `summaries_enabled`. */
  summariesEnabled: boolean;
  onSummarize: (item: NavItem) => void;
}

const GO_ICONS: Record<string, Icon> = {
  "go-ide": Icon.Code,
  "go-agent": Icon.Stars,
  "go-terminal": Icon.Terminal,
};

function render(action: ItemActionDescriptor, { item, go, onToggleDetails, onRefresh, onSummarize }: Props) {
  const shortcut = action.shortcut ? toShortcut(action.shortcut) : undefined;
  switch (action.kind) {
    case "go":
      return (
        <Action key={action.id} title={action.title} icon={Icon.ArrowRight} onAction={() => go(action.target, item)} />
      );
    case "go-role":
      return (
        <Action
          key={action.id}
          title={action.title}
          icon={GO_ICONS[action.id] ?? Icon.ArrowRight}
          shortcut={shortcut}
          onAction={() => go(action.target, item)}
        />
      );
    case "toggle-details":
      return (
        <Action
          key={action.id}
          title={action.title}
          icon={Icon.Sidebar}
          shortcut={shortcut}
          onAction={onToggleDetails}
        />
      );
    case "summarize":
      return (
        <Action
          key={action.id}
          title={action.title}
          icon={Icon.Wand}
          shortcut={shortcut}
          onAction={() => onSummarize(item)}
        />
      );
    case "focus-place":
      return (
        <ActionPanel.Submenu key={action.id} title={action.title} icon={Icon.AppWindowList} shortcut={shortcut}>
          {(action.places ?? []).map((p) => (
            <Action key={p.id} title={p.title} onAction={() => go(p.target, item)} />
          ))}
        </ActionPanel.Submenu>
      );
    case "copy-path":
      return (
        <Action.CopyToClipboard key={action.id} title={action.title} content={action.copy ?? ""} shortcut={shortcut} />
      );
    case "copy-ticket":
      return action.tickets ? (
        <ActionPanel.Submenu key={action.id} title={action.title} icon={Icon.Clipboard} shortcut={shortcut}>
          {action.tickets.map((t) => (
            <Action.CopyToClipboard key={t.id} title={t.title} content={t.text} />
          ))}
        </ActionPanel.Submenu>
      ) : (
        <Action.CopyToClipboard key={action.id} title={action.title} content={action.copy ?? ""} shortcut={shortcut} />
      );
    case "refresh":
      return (
        <Action
          key={action.id}
          title={action.title}
          icon={Icon.ArrowClockwise}
          shortcut={shortcut}
          onAction={onRefresh}
        />
      );
  }
}

export function ItemActions(props: Props) {
  return <ActionPanel>{itemActions(props.item, props.summariesEnabled).map((a) => render(a, props))}</ActionPanel>;
}
