import { Icon, LaunchType, MenuBarExtra, launchCommand } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useRef } from "react";
import { menubarModel, MENUBAR_TIMEOUT_MS } from "./journal/menubar-model";
import { createFylgjaJournalClient } from "./ui/client";

export default function Command() {
  const abortable = useRef<AbortController | null>(null);
  const { data, error, isLoading, revalidate } = usePromise(
    () => createFylgjaJournalClient().getFocusedJournal(abortable.current?.signal, { timeoutMs: MENUBAR_TIMEOUT_MS }),
    [],
    {
      abortable,
      // Shows nothing: the menu bar never toasts (R7).
      onError: () => undefined,
    },
  );

  // The latest outcome only: an error replaces any data left from an earlier run.
  const result = error ?? data;
  const model = result ? menubarModel(result) : undefined;

  const info = model?.items.filter((item) => item.kind === "info") ?? [];
  const actions = model?.items.filter((item) => item.kind !== "info") ?? [];

  return (
    <MenuBarExtra icon={{ source: "icon.png" }} title={model?.title} tooltip={model?.tooltip} isLoading={isLoading}>
      <MenuBarExtra.Section>
        {info.map((item, index) => (
          <MenuBarExtra.Item key={`info-${index}`} title={item.title} />
        ))}
      </MenuBarExtra.Section>
      <MenuBarExtra.Section>
        {actions.map((item) =>
          item.kind === "open-journal" ? (
            <MenuBarExtra.Item
              key={item.kind}
              title={item.title}
              icon={Icon.Book}
              onAction={() => launchCommand({ name: "journal", type: LaunchType.UserInitiated })}
            />
          ) : (
            <MenuBarExtra.Item
              key={item.kind}
              title={item.title}
              icon={Icon.ArrowClockwise}
              onAction={() => revalidate()}
            />
          ),
        )}
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
