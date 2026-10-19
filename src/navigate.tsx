import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  List,
  closeMainWindow,
  getApplications,
  getPreferenceValues,
  openCommandPreferences,
  showHUD,
} from "@raycast/api";
import { showFailureToast, useCachedPromise, useCachedState } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { ErrorView } from "./components/ErrorView";
import { ItemActions } from "./components/ItemActions";
import { ItemDetail } from "./components/ItemDetail";
import { FylgjaError, messages } from "./fylgja/errors";
import type { GoTarget, NavItem, Rankers, SummarizeResult } from "./fylgja/types";
import { runGo } from "./go";
import { buildAppIndex, iconFor, type AppIndex } from "./icons";
import {
  afterRankers,
  dropdownChange,
  dropdownValue,
  effectiveRank,
  planRankRetry,
  rankerOptions,
  tooltipFor,
} from "./rankers";
import { awayRows, daySections, navigationTitle, sections, showAwaySection, toRow, viewState } from "./rows";
import { onSummarizeAnswer, pollSummary } from "./summary-poll";
import { checkSecret, createFylgjaClient } from "./ui/client";
import { toAccessory, toIcon } from "./ui/icons-map";

interface Preferences {
  defaultRanker?: string;
  days?: string;
  onlyOpen?: boolean;
  groupByDay?: boolean;
}

const NO_PENDING: ReadonlySet<string> = new Set();
const NO_APPS: AppIndex = new Map();

function asFylgjaError(error: Error | undefined): FylgjaError | undefined {
  if (!error) return undefined;
  return error instanceof FylgjaError ? error : new FylgjaError("server_error", error.message);
}

export default function Command() {
  const { defaultRanker, days, onlyOpen: onlyOpenPref, groupByDay } = getPreferenceValues<Preferences>();
  const onlyOpen = onlyOpenPref ?? true;
  const [q, setQ] = useState("");
  const [showDetail, setShowDetail] = useCachedState("showDetail", false);
  // Real app icons: fallbacks show until the list of applications resolves; a failure is ignored.
  const [apps, setApps] = useState<AppIndex>(NO_APPS);
  useEffect(() => {
    let cancelled = false;
    getApplications()
      .then((list) => {
        if (!cancelled) setApps(buildAppIndex(list));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const abortable = useRef<AbortController | null>(null);
  const rankersAbortable = useRef<AbortController | null>(null);

  // The stored choice: `null` until the user picks one; `""` is the daemon's default. Not the dropdown's `storeValue`,
  // which cannot be cleared on `stale_choice`.
  const [stored, setStored] = useCachedState<string | null>("ranker", null);
  // The `defaultRanker` preference is skipped for the rest of this run once the daemon showed it unusable.
  const [prefDropped, setPrefDropped] = useState(false);
  const pref = prefDropped ? "" : (defaultRanker ?? "");
  const effective = effectiveRank(stored, pref);

  // The single unknown-ranker 422 refetch (R4): how many were made, the rank of the latest `/items` call, and whether
  // the refetch is under way (its 422 is then not shown).
  const rankRetries = useRef(0);
  const itemsRankSent = useRef("");
  const [retryingRank, setRetryingRank] = useState(false);

  const {
    data,
    error: rawError,
    isLoading,
    revalidate,
  } = useCachedPromise(
    (rank: string, query: string, daysPref: string | undefined, open: boolean) => {
      itemsRankSent.current = rank;
      return createFylgjaClient().getItems(
        { rank: rank === "" ? undefined : rank, q: query, days: daysPref ? Number(daysPref) : undefined, open },
        abortable.current?.signal,
      );
    },
    [effective, q, days, onlyOpen],
    {
      keepPreviousData: true,
      abortable,
      onData: () => setRetryingRank(false),
      onError: (err) => {
        if (!planRankRetry(rankRetries.current, err, itemsRankSent.current)) {
          setRetryingRank(false);
          return;
        }
        // Refetch once without the rank: drop the stored choice and the preference for this run.
        rankRetries.current += 1;
        setRetryingRank(true);
        if (stored !== null) setStored(null);
        setPrefDropped(true);
      },
    },
  );

  const { data: rankersData, error: rankersError } = useCachedPromise(
    (rank: string) => createFylgjaClient().getRankers(rank === "" ? undefined : rank, rankersAbortable.current?.signal),
    [effective],
    {
      keepPreviousData: true,
      abortable: rankersAbortable,
      onData: (answer: Rankers) => {
        const { storedNext, prefUsable } = afterRankers(stored, pref, answer);
        if (storedNext !== stored) setStored(storedNext);
        if (!prefUsable) setPrefDropped(true);
      },
      // A `/rankers` failure leaves only the default option; the list is unaffected.
      onError: () => {},
    },
  );

  const options = rankerOptions(rankersError ? undefined : rankersData);
  const shownRank = dropdownValue(options, effective);
  const rankerDropdown = (
    <List.Dropdown
      tooltip={tooltipFor(options, shownRank)}
      value={shownRank}
      onChange={(next) => {
        const change = dropdownChange(shownRank, next);
        if (change !== null) setStored(change);
      }}
    >
      {options.map((o) => (
        <List.Dropdown.Item key={`rank:${o.value}`} value={o.value} title={o.title} />
      ))}
    </List.Dropdown>
  );

  // Summaries: ids whose summary is running, one poll (and abort controller) per id. All polls end on unmount.
  const summariesEnabled = data?.summaries_enabled === true;
  const [pending, setPending] = useState<ReadonlySet<string>>(NO_PENDING);
  const polls = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const running = polls.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
    };
  }, []);

  const setPendingId = (id: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toast = (message: string) => showFailureToast(message, { title: "Fylgja" });

  const runPoll = async (id: string) => {
    const controller = new AbortController();
    polls.current.set(id, controller);
    setPendingId(id, true);
    try {
      const result = await pollSummary(id, {
        get: (ref, signal) => createFylgjaClient().getSummary(ref, signal),
        sleep: (ms, signal) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(done, ms);
            function done() {
              signal?.removeEventListener("abort", onAbort);
              resolve();
            }
            function onAbort() {
              clearTimeout(timer);
              resolve();
            }
            signal?.addEventListener("abort", onAbort, { once: true });
          }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      polls.current.delete(id);
      setPendingId(id, false);
      revalidate();
      if (result.state === "failed") {
        await toast(`The summary failed${result.error_kind ? ` (${result.error_kind})` : ""}`);
      } else if (result.state === "missing") {
        await toast("The summary job was lost");
      } else if (result.state === "timeout") {
        await toast("Still working; press ⌘S again later");
      } else if (result.state === "disabled") {
        await toast(messages.summaries_off());
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof FylgjaError && err.kind === "aborted")) return;
      polls.current.delete(id);
      setPendingId(id, false);
      revalidate();
      await toast(err instanceof FylgjaError ? err.message : "Fylgja could not read the summary");
    }
  };

  const summarize = async (item: NavItem) => {
    if (polls.current.has(item.id)) return;
    let answer: SummarizeResult | FylgjaError;
    try {
      answer = await createFylgjaClient().summarize(item.id);
    } catch (err) {
      answer = err instanceof FylgjaError ? err : new FylgjaError("server_error", "Fylgja could not summarize that");
    }
    const outcome = onSummarizeAnswer(answer);
    switch (outcome.type) {
      case "poll":
        await runPoll(item.id);
        break;
      case "refetch":
        revalidate();
        break;
      case "toast-refetch":
        revalidate();
        await toast(outcome.message);
        break;
      case "toast-hide":
      case "toast":
        await toast(outcome.message);
        break;
      case "none":
        break;
    }
  };

  const now = Date.now();
  // With "group by day" on, the daemon's groups must match its items; a mismatch is shown as the error (R7).
  const grouped = groupByDay === true && data !== undefined ? daySections(data, now) : undefined;
  const groupError = grouped && "error" in grouped ? grouped.error : undefined;
  const error = retryingRank ? undefined : (asFylgjaError(rawError) ?? groupError);
  const state = viewState({ loading: isLoading, data, error, q, onlyOpen });
  const showRows = state.kind === "list" && data !== undefined;

  const go = (target: GoTarget | undefined, item: NavItem | undefined) =>
    runGo(target, item, {
      checkSecret,
      closeMainWindow: () => closeMainWindow(),
      focus: (t) => createFylgjaClient().focus(t),
      showHUD: (message) => showHUD(message),
      showFailureToast: (message) => showFailureToast(message, { title: "Fylgja" }),
      refresh: () => revalidate(),
    });

  const detailOf = (item: NavItem | undefined) =>
    showDetail && item ? <ItemDetail item={item} pendingSummary={pending} now={now} /> : undefined;

  const refreshAction = (
    <Action
      title="Refresh"
      icon={Icon.ArrowClockwise}
      shortcut={Keyboard.Shortcut.Common.Refresh}
      onAction={() => revalidate()}
    />
  );

  const itemRow = (item: NavItem) => {
    const row = toRow(item, { pendingSummary: pending, now });
    return (
      <List.Item
        key={item.id}
        icon={toIcon(iconFor(item, apps))}
        title={row.title}
        subtitle={showDetail ? undefined : row.subtitle}
        accessories={showDetail ? [] : row.accessories.map(toAccessory)}
        detail={detailOf(item)}
        actions={
          <ItemActions
            item={item}
            go={go}
            onToggleDetails={() => setShowDetail((v) => !v)}
            onRefresh={() => revalidate()}
            summariesEnabled={summariesEnabled}
            onSummarize={(i) => void summarize(i)}
          />
        }
      />
    );
  };

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      throttle
      onSearchTextChange={setQ}
      isShowingDetail={showDetail && showRows}
      searchBarAccessory={rankerDropdown}
      navigationTitle={data && state.kind !== "error" ? navigationTitle(data, { onlyOpen }) : undefined}
    >
      {showRows
        ? sections(data, q).map((key) =>
            key === "away" ? (
              <List.Section key="away" title="Changed while you were away">
                {awayRows(data.while_away, now).map((row) => (
                  <List.Item
                    key={row.id}
                    icon={Icon.Bell}
                    title={row.title}
                    subtitle={row.subtitle}
                    accessories={row.accessories.map(toAccessory)}
                    detail={detailOf(data.items.find((i) => i.id === row.item))}
                    actions={
                      <ActionPanel>
                        {row.go ? (
                          <Action
                            title="Go"
                            icon={Icon.ArrowRight}
                            onAction={() =>
                              go(
                                row.go,
                                data.items.find((i) => i.id === row.item),
                              )
                            }
                          />
                        ) : null}
                        {refreshAction}
                      </ActionPanel>
                    }
                  />
                ))}
              </List.Section>
            ) : grouped && "sections" in grouped ? (
              grouped.sections.map((section) => (
                <List.Section key={`day:${section.title}`} title={section.title}>
                  {section.items.map(itemRow)}
                </List.Section>
              ))
            ) : (
              // Without a title, Raycast draws the items as part of the away section above them.
              <List.Section key="items" title={showAwaySection(data, q) ? "All items" : undefined}>
                {data.items.map(itemRow)}
              </List.Section>
            ),
          )
        : null}
      {state.kind === "error" && error ? (
        <ErrorView error={error}>
          {error.kind === "contract" ? (
            <Action title="Open Command Preferences" icon={Icon.Gear} onAction={() => openCommandPreferences()} />
          ) : null}
        </ErrorView>
      ) : state.kind === "loading" ? (
        <List.EmptyView />
      ) : state.kind !== "list" ? (
        <List.EmptyView
          title={state.title}
          actions={
            <ActionPanel>
              {state.offerPreferences ? (
                <Action
                  title="Show Items with Nothing Open…"
                  icon={Icon.Gear}
                  onAction={() => openCommandPreferences()}
                />
              ) : null}
              {refreshAction}
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}
