import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { api } from "../api";
import type { Activity as ActivityData, Notification, Runner } from "../types";
import { InterestList } from "./InterestList";

const labels: Record<string, string> = {
  visit: "viewed your profile",
  like: "is interested in you",
  match: "connected with you",
  message: "sent you a message",
  disconnect: "removed their interest",
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
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      api<ActivityData>("/me/activity", "GET", undefined, controller.signal),
      api<{ notifications: Notification[]; next_before: number | null }>(
        "/notifications",
        "GET",
        undefined,
        controller.signal,
      ),
    ])
      .then(([a, n]) => {
        setActivity(a);
        setNotifications(n.notifications);
        setNext(n.next_before);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh, revision]);
  const visitors = activity?.visitors || [],
    likes = activity?.likes || [],
    sent = activity?.sent || [],
    blocks = activity?.blocks || [];
  const count =
    tab === "notifications"
      ? notifications.length
      : tab === "visitors"
        ? visitors.length
        : tab === "likes"
          ? likes.length
          : tab === "sent" ? sent.length : blocks.length;
  async function changeInterest(id: number, remove: boolean) {
    await api(`/profiles/${id}/like`, remove ? "DELETE" : "POST");
    const response = await api<ActivityData>("/me/activity");
    setActivity(response);
    await changed();
  }
  return (
    <>
      <div className="eyebrow">YOUR CONNECTIONS</div>
      <h1>
        A little interest
        <br />
        goes a long way.
      </h1>
      <div className="tabs" role="tablist" aria-label="Activity type">
        {[
          ["notifications", "Notifications"],
          ["visitors", "Visitors"],
          ["likes", "Received interest"],
          ["sent", "Sent interest"],
          ["blocks", "Blocked users"],
        ].map(([key, label]) => (
          <button
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "active" : ""}
            key={key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="actions">
        <button
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </button>
        {tab === "notifications" && (
          <button
            disabled={!notifications.length || loading}
            onClick={() =>
              void run(async () => {
                await api("/notifications/read", "POST", {
                  through_id: notifications[0].id,
                });
                setNotifications((list) =>
                  list.map((n) => ({ ...n, is_read: true })),
                );
                await changed();
              })
            }
          >
            Mark all read
          </button>
        )}
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading your activity…</p>}
      {!loading && !error && (
        <div className="activity">
          {tab === "notifications" &&
            notifications.map((item) => (
              <button
                className={item.is_read ? "" : "unread"}
                key={item.id}
                onClick={() => void run(() => openProfile(item.actor))}
              >
                <Heart size={20} />
                <span>
                  <strong>{item.username}</strong> ·{" "}
                  {labels[item.kind] || item.kind}
                </span>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </button>
            ))}
          {tab === "visitors" &&
            visitors.map((item) => (
              <button
                key={item.id}
                onClick={() => void run(() => openProfile(item.actor))}
              >
                <span>
                  <strong>{item.username}</strong> visited your profile
                </span>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </button>
            ))}
          {(tab === "likes" || tab === "sent") && <InterestList
            items={tab === "sent" ? sent : likes} sent={tab === "sent"}
            busy={busy} run={run} openProfile={openProfile} changeInterest={changeInterest} />}
          {tab === "blocks" &&
            blocks.map((item) => (
              <div className="blocked-row" key={item.actor}>
                <strong>{item.username}</strong>
                <button
                  onClick={() =>
                    void run(async () => {
                      await api(`/profiles/${item.actor}/block`, "DELETE");
                      setRefresh((value) => value + 1);
                      await changed();
                    })
                  }
                >
                  Unblock
                </button>
              </div>
            ))}
          {!count && tab !== "likes" && tab !== "sent" && <p>No {tab} yet.</p>}
        </div>
      )}
      {!loading && tab === "notifications" && next && (
        <button
          onClick={() =>
            void run(async () => {
              const response = await api<{
                notifications: Notification[];
                next_before: number | null;
              }>("/notifications?before=" + next);
              setNotifications((items) => [
                ...items,
                ...response.notifications,
              ]);
              setNext(response.next_before);
            })
          }
        >
          Older notifications
        </button>
      )}
      {!loading && tab === "visitors" && activity?.next_before && (
        <button
          onClick={() =>
            void run(async () => {
              const response = await api<ActivityData>(
                "/me/activity?before=" + activity.next_before,
              );
              setActivity({
                ...response,
                visitors: [...visitors, ...response.visitors],
              });
            })
          }
        >
          Older visits
        </button>
      )}
    </>
  );
}
