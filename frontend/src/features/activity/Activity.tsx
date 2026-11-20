import { useSearchParams } from "react-router";
import { UiButton } from "../../shared/UiButton";
import { useEffect, useRef, useState } from "react";
import { Check, MailOpen, MessageCircle, User, Users } from "lucide-react";
import { Switch } from "@heroui/react";
import { api } from "../../shared/api";
import { historyWindow } from "./history";
import type {
  Activity as ActivityData,
  Notification,
  Runner,
} from "../../shared/types";
import { InterestList } from "./InterestList";
import { NotificationList } from "./NotificationList";
import { activityDateLabel } from "./date";

const tabs = [
  ["notifications", "All"],
  ["visitors", "Visitors"],
  ["connections", "Connections"],
  ["likes", "Received interest"],
  ["sent", "Sent interest"],
  ["blocks", "Blocked users"],
];
type NotificationPage = {
  notifications: Notification[];
  next_before: number | null;
};

export function Activity({
  run,
  openProfile,
  openConversation,
  changed,
  revision,
  busy,
  unreadCount,
}: {
  run: Runner;
  openProfile: (id: number) => Promise<void>;
  openConversation: (id: number) => void;
  changed: () => Promise<void>;
  revision: string;
  busy: boolean;
  unreadCount: number;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab = tabs.some(([key]) => key === requestedTab)
    ? requestedTab!
    : "notifications";
  function setTab(nextTab: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("tab", nextTab);
        return next;
      },
      { preventScrollReset: true },
    );
  }
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const notificationFloor = useRef<number | null>(null);
  const visitorFloor = useRef<number | null>(null);
  const mutation = useRef(0);

  function reload() {
    mutation.current++;
    setRefresh((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      const version = mutation.current;
      try {
        const [a, n] = await Promise.all([
          (async () => {
            const first = await api<ActivityData>(
              "/me/activity",
              "GET",
              undefined,
              controller.signal,
            );
            const visits = await historyWindow(async (before) => {
              const page =
                before === null
                  ? first
                  : await api<ActivityData>(
                      `/me/activity?before=${before}`,
                      "GET",
                      undefined,
                      controller.signal,
                    );
              return { items: page.visitors, next_before: page.next_before };
            }, visitorFloor.current);
            return {
              ...first,
              visitors: visits.items,
              next_before: visits.next_before,
            };
          })(),
          historyWindow(async (before) => {
            const query = new URLSearchParams({ unread: String(unreadOnly) });
            if (before !== null) query.set("before", String(before));
            const page = await api<NotificationPage>(
              `/notifications?${query}`,
              "GET",
              undefined,
              controller.signal,
            );
            return { items: page.notifications, next_before: page.next_before };
          }, notificationFloor.current),
        ]);
        if (controller.signal.aborted || version !== mutation.current) return;
        setActivity(a);
        setNotifications(n.items);
        setNext(n.next_before);
        visitorFloor.current = a.visitors.at(-1)?.id ?? null;
        notificationFloor.current = n.items.at(-1)?.id ?? null;
        setError("");
      } catch (e) {
        if (!controller.signal.aborted && version === mutation.current)
          setError((e as Error).message);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh, revision, unreadOnly]);

  async function changeInterest(id: number, remove: boolean) {
    await api(`/profiles/${id}/like`, remove ? "DELETE" : "POST");
    const response = await api<ActivityData>("/me/activity");
    reload();
    setActivity((current) =>
      current
        ? {
            ...current,
            likes: response.likes,
            sent: response.sent,
            connections: response.connections,
          }
        : response,
    );
    await changed();
  }
  async function markRead(item: Notification) {
    if (item.is_read) return;
    await api(`/notifications/${item.id}/read`, "POST");
    reload();
    setAnnouncement(`Notification from ${item.username} marked as read.`);
    setNotifications((items) =>
      unreadOnly
        ? items.filter((n) => n.id !== item.id)
        : items.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)),
    );
    await changed();
  }
  async function markAllRead() {
    const through = notifications[0]?.id;
    if (!through) return;
    await api("/notifications/read", "POST", { through_id: through });
    reload();
    setAnnouncement("Notifications marked as read.");
    setNotifications((items) =>
      unreadOnly
        ? items.filter((n) => n.id > through)
        : items.map((n) => (n.id <= through ? { ...n, is_read: true } : n)),
    );
    await changed();
  }
  async function olderNotifications() {
    if (!next) return;
    const response = await api<NotificationPage>(
      `/notifications?before=${next}&unread=${unreadOnly}`,
    );
    notificationFloor.current =
      response.notifications.at(-1)?.id ?? notificationFloor.current;
    reload();
    setNotifications((items) =>
      [
        ...new Map(
          [...items, ...response.notifications].map((n) => [n.id, n]),
        ).values(),
      ].sort((a, b) => b.id - a.id),
    );
    setNext(response.next_before);
  }
  async function olderVisitors() {
    if (!activity?.next_before) return;
    const response = await api<ActivityData>(
      `/me/activity?before=${activity.next_before}`,
    );
    visitorFloor.current = response.visitors.at(-1)?.id ?? visitorFloor.current;
    reload();
    setActivity((current) =>
      current
        ? {
            ...current,
            visitors: [
              ...new Map(
                [...current.visitors, ...response.visitors].map((v) => [
                  v.id,
                  v,
                ]),
              ).values(),
            ].sort((a, b) => b.id - a.id),
            next_before: response.next_before,
          }
        : response,
    );
  }
  const visitors = activity?.visitors || [];
  const connections = activity?.connections || [];
  const blocks = activity?.blocks || [];

  function changeUnreadFilter(selected: boolean) {
    notificationFloor.current = null;
    mutation.current++;
    setNotifications([]);
    setNext(null);
    setLoading(true);
    setUnreadOnly(selected);
  }

  return (
    <section className="mx-auto w-full max-w-[760px]">
      <p className="mb-2 mt-0 text-[10px] font-bold tracking-[2.3px] text-matcha-accent">
        YOUR CONNECTIONS
      </p>
      <h1 className="mb-5 mt-0 text-[clamp(2.5rem,5vw,3.25rem)] font-medium leading-[1.12] tracking-[-2px]">
        A little interest{" "}
        <em className="font-serif font-normal text-matcha-accent">
          goes a long way.
        </em>
      </h1>

      <div
        className="w-full overflow-x-auto border-b border-matcha-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Activity type"
      >
        <div className="flex w-max min-w-full items-stretch">
          {tabs.map(([key, label], index) => (
            <button
              type="button"
              role="tab"
              id={`activity-tab-${key}`}
              aria-controls="activity-panel"
              aria-selected={tab === key}
              tabIndex={tab === key ? 0 : -1}
              className={`inline-flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-matcha-accent h-12 shrink-0 !rounded-none !border-0 !border-b-2 px-2 text-[13px] font-medium leading-none sm:text-sm ${key === "notifications" ? "!w-[142px] !min-w-[142px] !max-w-[142px]" : key === "visitors" ? "!w-[88px] !min-w-[88px] !max-w-[88px]" : key === "connections" ? "!w-[112px] !min-w-[112px] !max-w-[112px]" : key === "likes" ? "!w-[142px] !min-w-[142px] !max-w-[142px]" : key === "sent" ? "!w-[108px] !min-w-[108px] !max-w-[108px]" : "!w-[128px] !min-w-[128px] !max-w-[128px]"} ${tab === key ? "!border-matcha-accent !bg-transparent font-semibold !text-matcha-accent" : "!border-transparent !bg-transparent !text-matcha-muted hover:!bg-matcha-raised/50"}`}
              key={key}
              onClick={() => setTab(key)}
              onKeyDown={(event) => {
                const offset =
                  event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowLeft"
                      ? -1
                      : 0;
                const target =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (index + offset + tabs.length) % tabs.length;
                if (!offset && event.key !== "Home" && event.key !== "End")
                  return;
                event.preventDefault();
                setTab(tabs[target][0]);
                document
                  .getElementById(`activity-tab-${tabs[target][0]}`)
                  ?.focus();
              }}
            >
              {label}
              {key === "notifications" && unreadCount > 0 && (
                <span className="grid min-w-5 place-items-center rounded-full bg-matcha-accent px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <div
        className="pt-4"
        role="tabpanel"
        id="activity-panel"
        aria-labelledby={`activity-tab-${tab}`}
      >
        {error && (
          <p
            className="mb-4 rounded-xl bg-[var(--danger-bg)] p-3.5 text-sm text-[var(--danger-text)]"
            role="alert"
          >
            {error} Your activity will refresh automatically.
          </p>
        )}
        {tab === "notifications" && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-xs text-matcha-muted">
              {unreadCount} unread
            </p>
            <div className="flex flex-wrap items-center gap-2.5 text-xs text-matcha-muted">
              <span>Unread only</span>
              <Switch
                aria-label="Unread only"
                isSelected={unreadOnly}
                onChange={changeUnreadFilter}
                size="sm"
              >
                <Switch.Control className="!h-5 !w-9 !rounded-full !bg-matcha-border group-data-[selected=true]:!bg-matcha-accent">
                  <Switch.Thumb className="!size-4 !rounded-full !bg-white !shadow-sm" />
                </Switch.Control>
              </Switch>
              <UiButton
                disabled={busy || loading || unreadCount === 0}
                className="min-h-9 rounded-full px-3 text-xs"
                onClick={() => void run(markAllRead)}
              >
                <MailOpen size={14} /> Mark all read
              </UiButton>
            </div>
          </div>
        )}
        {loading ? (
          <p
            className="py-8 text-center text-sm text-matcha-muted"
            role="status"
          >
            Loading your activity…
          </p>
        ) : (
          <div className="grid gap-4 pt-1">
            {tab === "notifications" && (
              <>
                <NotificationList
                  items={notifications}
                  busy={busy}
                  run={run}
                  markRead={markRead}
                  open={async (item) => {
                    await markRead(item);
                    await openProfile(item.actor);
                  }}
                />
                {!notifications.length && !error && (
                  <div className="rounded-2xl border border-matcha-border bg-matcha-surface px-5 py-12 text-center text-matcha-muted">
                    <Check className="mx-auto text-matcha-accent" size={30} />
                    <h2 className="mb-2 mt-3 text-lg font-semibold text-matcha-text">
                      {unreadOnly
                        ? "You’re all caught up"
                        : "Your story starts here"}
                    </h2>
                    <p className="m-0 text-sm">
                      {unreadOnly
                        ? "No unread notifications. Switch off the filter to see your history."
                        : "Profile visits, interest, connections, and messages will appear here."}
                    </p>
                  </div>
                )}
                {next && (
                  <UiButton
                    className="mx-auto min-h-10 rounded-full px-4 text-sm"
                    disabled={busy}
                    onClick={() => void run(olderNotifications)}
                  >
                    Older notifications
                  </UiButton>
                )}
              </>
            )}
            {tab === "visitors" && (
              <div className="grid gap-4">
                {visitors.length > 0 ? (
                  <div className="overflow-hidden rounded-2xl border border-matcha-border bg-matcha-surface">
                    {visitors.map((item, index) => (
                      <button
                        type="button"
                        className={`flex w-full min-w-0 cursor-pointer items-center gap-3 px-3 py-3.5 text-left transition-colors hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-matcha-accent sm:px-4 ${index ? "border-t border-matcha-border/70" : ""}`}
                        key={item.id}
                        onClick={() => void run(() => openProfile(item.actor))}
                      >
                        {item.photo_id ? (
                          <img
                            className="size-11 shrink-0 rounded-full object-cover sm:size-12"
                            src={`/api/v1/photos/${item.photo_id}`}
                            alt=""
                          />
                        ) : (
                          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-matcha-accent/10 text-matcha-accent sm:size-12">
                            <User size={21} />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <strong className="block text-sm font-semibold text-matcha-text">
                            {[item.first_name, item.last_name]
                              .filter(Boolean)
                              .join(" ") || item.username}
                          </strong>
                          <span className="mt-1 block text-xs text-matcha-muted">
                            @{item.username} · Visited your profile
                          </span>
                        </span>
                        <time
                          className="shrink-0 text-[11px] text-matcha-muted sm:text-xs"
                          dateTime={item.created_at}
                        >
                          {activityDateLabel(item.created_at)}
                        </time>
                      </button>
                    ))}
                  </div>
                ) : null}
                {!visitors.length && !error && (
                  <div className="rounded-2xl border border-matcha-border bg-matcha-surface px-5 py-12 text-center text-sm text-matcha-muted">
                    No visitors yet.
                  </div>
                )}
                {activity?.next_before && (
                  <UiButton
                    className="mx-auto min-h-10 rounded-full px-4 text-sm"
                    disabled={busy}
                    onClick={() => void run(olderVisitors)}
                  >
                    Older visits
                  </UiButton>
                )}
              </div>
            )}
            {tab === "connections" && (
              <div className="grid gap-2">
                {connections.map((item) => (
                  <article
                    className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-matcha-border bg-matcha-surface p-3 sm:flex-nowrap sm:p-4"
                    key={item.actor}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 basis-[200px] items-center gap-3 text-left focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-matcha-accent"
                      aria-label={`View ${item.first_name} ${item.last_name}’s profile`}
                      onClick={() => void run(() => openProfile(item.actor))}
                    >
                      {item.photo_id ? (
                        <img
                          className="size-12 shrink-0 rounded-full object-cover"
                          src={`/api/v1/photos/${item.photo_id}`}
                          alt=""
                        />
                      ) : (
                        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-matcha-accent/10 text-matcha-accent">
                          <User size={21} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm font-semibold text-matcha-text">
                          {[item.first_name, item.last_name]
                            .filter(Boolean)
                            .join(" ") || item.username}
                        </strong>
                        <span className="mt-1 block truncate text-xs text-matcha-muted">
                          @{item.username}
                          {item.city ? ` · ${item.city}` : ""}
                        </span>
                      </span>
                    </button>
                    <div className="ml-auto flex shrink-0 gap-2">
                      <UiButton
                        className="min-h-9 rounded-full !border-matcha-accent !bg-matcha-accent px-3 text-xs !text-white hover:!bg-matcha-accent/90"
                        onClick={() => openConversation(item.actor)}
                      >
                        <MessageCircle size={14} /> Chat
                      </UiButton>
                      <UiButton
                        className="min-h-9 rounded-full px-3 text-xs"
                        disabled={busy}
                        onClick={() =>
                          void run(() => changeInterest(item.actor, true))
                        }
                      >
                        Remove interest
                      </UiButton>
                    </div>
                  </article>
                ))}
                {!connections.length && !error && (
                  <div className="rounded-2xl border border-matcha-border bg-matcha-surface px-5 py-12 text-center text-matcha-muted">
                    <Users
                      className="mx-auto text-matcha-accent"
                      size={30}
                      aria-hidden="true"
                    />
                    <h2 className="mb-2 mt-3 text-lg font-semibold text-matcha-text">
                      No connections yet
                    </h2>
                    <p className="m-0 text-sm">
                      Your mutual connections will appear here.
                    </p>
                  </div>
                )}
              </div>
            )}
            {(tab === "likes" || tab === "sent") && (
              <InterestList
                items={
                  (tab === "sent" ? activity?.sent : activity?.likes) || []
                }
                sent={tab === "sent"}
                busy={busy}
                run={run}
                openProfile={openProfile}
                changeInterest={changeInterest}
              />
            )}
            {tab === "blocks" && (
              <>
                {blocks.map((item) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-2xl border border-matcha-border bg-matcha-surface p-4"
                    key={item.actor}
                  >
                    <strong className="min-w-0 truncate text-sm text-matcha-text">
                      @{item.username}
                    </strong>
                    <UiButton
                      className="min-h-9 shrink-0 rounded-full px-3 text-xs"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`/profiles/${item.actor}/block`, "DELETE");
                          reload();
                          await changed();
                        })
                      }
                    >
                      Unblock
                    </UiButton>
                  </div>
                ))}
                {!blocks.length && !error && (
                  <div className="rounded-2xl border border-matcha-border bg-matcha-surface px-5 py-12 text-center text-sm text-matcha-muted">
                    No blocked users.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
