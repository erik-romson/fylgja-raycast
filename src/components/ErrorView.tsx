import { Action, ActionPanel, Clipboard, Icon, List } from "@raycast/api";
import type { ReactNode } from "react";
import type { FylgjaError } from "../fylgja/errors";

const START_COMMAND = "fylgja serve";
const LOGIN_HINT = "`fylgja install launchd --apply` starts the daemon at login.";

export function ErrorView({ error, children }: { error: FylgjaError; children?: ReactNode }) {
  const down = error.kind === "daemon_down";
  return (
    <List.EmptyView
      icon={Icon.ExclamationMark}
      title={error.message}
      description={down ? `Start it with \`${START_COMMAND}\`. ${LOGIN_HINT}` : undefined}
      actions={
        <ActionPanel>
          {down ? (
            <Action title="Copy Start Command" icon={Icon.Clipboard} onAction={() => Clipboard.copy(START_COMMAND)} />
          ) : null}
          {children}
        </ActionPanel>
      }
    />
  );
}
