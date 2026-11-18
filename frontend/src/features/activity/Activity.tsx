import { UiInput, UiTextarea } from "../../shared/UiInput";
import { UiButton } from "../../shared/UiButton";
import { useEffect, useRef, useState } from "react";
import { Bell, Eye } from "lucide-react";
import { api } from "../../shared/api";
import { historyWindow } from "./history";
import type {
  Activity as ActivityData,
  Notification,
  Runner,
} from "../../shared/types";
import { InterestList } from "./InterestList";
import { NotificationList } from "./NotificationList";

const tabs = [
  ["notifications", "Notifications"],
  ["visitors", "Visitors"],
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
  changed,
  revision,
  busy,
}: {
  run: Runner;
  openProfile: (id: number) => Promise<void>;
  changed: () => Promise<void>;
  revision: string;
  busy: boolean;
}) {
  const [tab, setTab] = useState("notifications");
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
        ? { ...current, likes: response.likes, sent: response.sent }
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
  const blocks = activity?.blocks || [];

  return (
    <>
      <div className="eyebrow [font-size:10px] [font-weight:700] [letter-spacing:2.3px] [color:var(--accent)] [display:flex] [align-items:center] [gap:8px]">
        YOUR CONNECTIONS
      </div>
      <h1 className="my-5 text-[clamp(2.5rem,5vw,4rem)] font-medium leading-[1.12] tracking-[-2px]">
        A little interest
        <br />
        goes a long way.
      </h1>
      <div
        className="tabs [display:flex] [gap:8px] [flex-wrap:wrap] max-[650px]:[&_button]:[font-size:11px]"
        role="tablist"
        aria-label="Activity type"
      >
        {tabs.map(([key, label], index) => (
          <UiButton
            role="tab"
            id={`activity-tab-${key}`}
            aria-controls="activity-panel"
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            className={tab === key ? "active" : ""}
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
          </UiButton>
        ))}
      </div>
      <p
        className="sr-only [position:absolute] [width:1px] [height:1px] [padding:0] [margin:-1px] [overflow:hidden] [clip:rect(0,_0,_0,_0)] [white-space:nowrap] [border:0]"
        role="status"
        aria-live="polite"
      >
        {announcement}
      </p>
      <div
        role="tabpanel"
        id="activity-panel"
        aria-labelledby={`activity-tab-${tab}`}
      >
        <div className="actions activity-controls [display:flex] [gap:10px] [flex-wrap:wrap] [margin-top:25px] [align-items:center] max-[650px]:[gap:6px] max-[650px]:[&__>button]:[font-size:12px]">
          <UiButton disabled={loading || busy} onClick={reload}>
            Refresh
          </UiButton>
          {tab === "notifications" && (
            <>
              <label className="unread-toggle [display:flex] [align-items:center] [gap:8px] [font-size:13px] [cursor:pointer] [padding:10px] [&_input]:[width:16px] [&_input]:[height:16px] [&_input]:[padding:0] [&_input]:[accent-color:var(--accent)]">
                <UiInput
                  type="checkbox"
                  checked={unreadOnly}
                  disabled={busy}
                  onChange={(event) => {
                    notificationFloor.current = null;
                    mutation.current++;
                    setNotifications([]);
                    setNext(null);
                    setLoading(true);
                    setUnreadOnly(event.target.checked);
                  }}
                />{" "}
                Unread only
              </label>
              <UiButton
                disabled={
                  busy || loading || !notifications.some((n) => !n.is_read)
                }
                onClick={() => void run(markAllRead)}
              >
                Mark all read
              </UiButton>
            </>
          )}
        </div>
        {error && (
          <p
            className="mb-6 flex justify-between rounded-lg bg-[var(--danger-bg)] p-[15px] text-[var(--danger-text)]"
            role="alert"
          >
            {error} Your activity will refresh automatically.
          </p>
        )}
        {loading && <p role="status">Loading your activity…</p>}
        {!loading && (
          <div className="activity [display:flex] [flex-direction:column] [gap:10px] [margin-top:30px] [&_button]:[display:flex] [&_button]:[align-items:center] [&_button]:[gap:18px] [&_button]:[text-align:left] [&_button]:[padding:20px] [&_small]:[margin-left:auto] [&_small]:[color:var(--muted)] max-[600px]:[&_button]:[flex-wrap:wrap] max-[600px]:[&_small]:[margin:0] [&_button_>span]:[overflow-wrap:anywhere] [&_button_>span]:[min-width:0] [&_.badge]:[margin-left:auto]">
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
                  <div className="empty [text-align:center] [padding:50px] [background:var(--accent-soft)] [border-radius:15px] [color:var(--muted)]">
                    <Bell size={32} />
                    <h2>
                      {unreadOnly
                        ? "You’re all caught up"
                        : "Your story starts here"}
                    </h2>
                    <p>
                      {unreadOnly
                        ? "No unread notifications. Switch off the filter to see your history."
                        : "Profile visits, interest, connections, and messages will appear here."}
                    </p>
                  </div>
                )}
                {next && (
                  <UiButton
                    disabled={busy}
                    onClick={() => void run(olderNotifications)}
                  >
                    Older notifications
                  </UiButton>
                )}
              </>
            )}
            {tab === "visitors" && (
              <>
                {visitors.map((item) => (
                  <UiButton
                    key={item.id}
                    onClick={() => void run(() => openProfile(item.actor))}
                  >
                    <Eye size={20} />
                    <span>
                      <strong>{item.username}</strong> visited your profile
                    </span>
                    <small>
                      <time dateTime={item.created_at}>
                        {new Date(item.created_at).toLocaleString()}
                      </time>
                    </small>
                  </UiButton>
                ))}
                {!visitors.length && !error && <p>No visitors yet.</p>}
                {activity?.next_before && (
                  <UiButton
                    disabled={busy}
                    onClick={() => void run(olderVisitors)}
                  >
                    Older visits
                  </UiButton>
                )}
              </>
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
                    className="blocked-row [display:flex] [align-items:center] [justify-content:space-between] [padding:18px] [border:1px_solid_var(--border)] [background:var(--surface)] [border-radius:10px]"
                    key={item.actor}
                  >
                    <strong>{item.username}</strong>
                    <UiButton
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
                {!blocks.length && !error && <p>No blocked users.</p>}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
