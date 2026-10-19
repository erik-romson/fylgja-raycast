import { Action, ActionPanel, Color, Icon, List, closeMainWindow, open, showToast, Toast } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { useRef } from "react";
import { ErrorView } from "./components/ErrorView";
import { HowView } from "./components/HowView";
import { FylgjaError, messages } from "./fylgja/errors";
import type { FocusedJournal, JournalThread } from "./fylgja/journal-types";
import {
  runJournalAction,
  runOpenSource,
  type ActionDeps,
  type RunnableAction,
  type ToastAction,
} from "./journal/actions";
import {
  journalActions,
  journalView,
  navigationTitle,
  refreshOnlyActions,
  rowDetail,
  type JournalActionDescriptor,
  type JournalRow,
} from "./journal/model";
import { planOpen } from "./journal/open-source";
import { checkSecret, createFylgjaClient, createFylgjaJournalClient, currentBaseUrl } from "./ui/client";
import { toShortcut } from "./ui/icons-map";

const ICONS: Record<JournalActionDescriptor["id"], Icon> = {
  how: Icon.QuestionMark,
  "mark-done": Icon.CheckCircle,
  "open-source": Icon.ArrowRight,
  "make-todo": Icon.Checkmark,
  "todo-exists": Icon.Checkmark,
  pin: Icon.Pin,
  drop: Icon.Trash,
  refresh: Icon.ArrowClockwise,
};

function asFylgjaError(error: Error | undefined): FylgjaError | undefined {
  if (!error) return undefined;
  return error instanceof FylgjaError ? error : new FylgjaError("server_error", error.message);
}

export default function Command() {
  const abortable = useRef<AbortController | null>(null);
  const {
    data,
    error: rawError,
    isLoading,
    revalidate,
  } = useCachedPromise(() => createFylgjaJournalClient().getFocusedJournal(abortable.current?.signal), [], {
    abortable,
    keepPreviousData: true,
  });
  const error = asFylgjaError(rawError);
  const now = Date.now();

  const toastAction = (action?: ToastAction) =>
    action ? { title: action.title, onAction: () => void action.run() } : undefined;

  const actionDeps = (): ActionDeps => {
    const client = createFylgjaJournalClient();
    return {
      patchItem: (id, patch) => client.patchItem(id, patch),
      makeTodo: (id) => client.makeTodo(id),
      refetch: () => revalidate(),
      showToast: ({ title, action }) =>
        showToast({ style: Toast.Style.Success, title, primaryAction: toastAction(action) }),
      showFailureToast: (message, action) =>
        showFailureToast(message, { title: "Fylgja", primaryAction: toastAction(action) }),
    };
  };

  const run = (action: RunnableAction, item: Parameters<typeof runJournalAction>[1]) => {
    try {
      return runJournalAction(action, item, actionDeps());
    } catch (err) {
      return showFailureToast(err instanceof FylgjaError ? err.message : "Fylgja could not do that", {
        title: "Fylgja",
      });
    }
  };

  const openSource = (row: JournalRow, thread: JournalThread) => {
    const source = row.item?.source;
    const plan = source ? planOpen(source, thread.repo_root) : null;
    if (!plan) return;
    try {
      const client = createFylgjaClient();
      return runOpenSource(plan, {
        checkSecret,
        focus: (target) => client.focus(target),
        closeMainWindow: () => closeMainWindow(),
        open: (target) => open(target),
        showFailureToast: (message, action) =>
          showFailureToast(message, { title: "Fylgja", primaryAction: toastAction(action) }),
        baseUrl: currentBaseUrl(),
      });
    } catch (err) {
      return showFailureToast(err instanceof FylgjaError ? err.message : "Fylgja could not open that", {
        title: "Fylgja",
      });
    }
  };

  const refreshAction = (descriptor: JournalActionDescriptor) => (
    <Action
      key={descriptor.id}
      title={descriptor.title}
      icon={ICONS[descriptor.id]}
      shortcut={descriptor.shortcut ? toShortcut(descriptor.shortcut) : undefined}
      onAction={() => revalidate()}
    />
  );

  const panel = (row: JournalRow, thread: JournalThread) => {
    const item = row.item;
    const descriptors = item ? journalActions(item) : refreshOnlyActions();
    return (
      <ActionPanel>
        {descriptors.map((d) => {
          if (d.id === "refresh") return refreshAction(d);
          if (!item) return null;
          if (d.id === "how") {
            return <Action.Push key={d.id} title={d.title} icon={ICONS[d.id]} target={<HowView itemId={item.id} />} />;
          }
          const id = d.id;
          return (
            <Action
              key={id}
              title={d.title}
              icon={ICONS[d.id]}
              style={d.destructive ? Action.Style.Destructive : undefined}
              shortcut={d.shortcut ? toShortcut(d.shortcut) : undefined}
              onAction={() => {
                if (id === "open-source") void openSource(row, thread);
                else void run(id, item);
              }}
            />
          );
        })}
      </ActionPanel>
    );
  };

  const rowItem = (row: JournalRow, thread: JournalThread, detail: string) => (
    <List.Item
      key={row.id}
      id={row.id}
      icon={row.kind === "headline" ? Icon.Dot : row.kind === "where" ? Icon.Compass : Icon.Circle}
      title={row.title}
      subtitle={row.subtitle}
      accessories={row.pinned ? [{ icon: { source: Icon.Pin, tintColor: Color.Orange }, tooltip: "Pinned" }] : []}
      detail={<List.Item.Detail markdown={detail} />}
      actions={panel(row, thread)}
    />
  );

  const body = (focused: FocusedJournal | undefined) => {
    if (!focused) return <List.EmptyView />;
    if (focused.kind === "off") return <List.EmptyView icon={Icon.ExclamationMark} title={messages.journal_off()} />;
    if (focused.kind === "empty") return <List.EmptyView title={focused.detail} />;
    const thread = focused.thread;
    const view = journalView(thread, now);
    if (view.kind === "empty") {
      return <List.EmptyView title={view.title} description={view.description} />;
    }
    if (view.kind === "where-only") return rowItem(view.row, thread, view.row.detail ?? "");
    return view.sections.map((section) => (
      <List.Section key={section.id} title={section.title}>
        {section.rows.map((row) => rowItem(row, thread, rowDetail(thread, row)))}
      </List.Section>
    ));
  };

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      navigationTitle={!error && data?.kind === "thread" ? navigationTitle(data.thread) : undefined}
    >
      {error ? <ErrorView error={error} /> : body(data)}
    </List>
  );
}
