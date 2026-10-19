import { Action, ActionPanel, Detail, Icon, Keyboard } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { FylgjaError } from "../fylgja/errors";
import type { JournalHow } from "../fylgja/journal-types";
import { escapeMarkdown } from "../format";
import { howMarkdown } from "../journal/model";
import { createFylgjaJournalClient } from "../ui/client";

function failureText(err: unknown): string {
  return escapeMarkdown(err instanceof FylgjaError ? err.message : "Fylgja could not read the checklist");
}

/** Pushed by How Do I Do This?: asks for the checklist once on mount and reads it again on ⌘R. */
export function HowView({ itemId }: { itemId: string }) {
  const [markdown, setMarkdown] = useState<string>("Asking Fylgja…");
  const [isLoading, setLoading] = useState(true);
  const requested = useRef(false);
  const aborter = useRef<AbortController | null>(null);

  const show = (how: JournalHow) => setMarkdown(howMarkdown(how));

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    createFylgjaJournalClient()
      .requestHow(itemId)
      .then(show)
      .catch((err: unknown) => {
        if (err instanceof FylgjaError && err.kind === "aborted") return;
        setMarkdown(failureText(err));
      })
      .finally(() => setLoading(false));
    return () => aborter.current?.abort();
  }, [itemId]);

  const reread = async () => {
    aborter.current?.abort();
    const controller = new AbortController();
    aborter.current = controller;
    setLoading(true);
    try {
      const how = await createFylgjaJournalClient().getHow(itemId, controller.signal);
      if (!controller.signal.aborted) show(how);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof FylgjaError && err.kind === "aborted")) return;
      setMarkdown(failureText(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  return (
    <Detail
      navigationTitle="How Do I Do This?"
      isLoading={isLoading}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={() => void reread()}
          />
        </ActionPanel>
      }
    />
  );
}
