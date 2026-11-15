import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { api } from "../../shared/api";
import type { Conversation, Runner } from "../../shared/types";

export function Inbox({
  revision,
  openProfile,
  run,
}: {
  revision: number;
  openProfile: (id: number) => Promise<void>;
  run: Runner;
}) {
  const [items, setItems] = useState<Conversation[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true,
      inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await api<{ conversations: Conversation[] }>(
          "/conversations",
        );
        if (active) {
          setItems(response.conversations);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [revision, refresh]);
  return (
    <>
      <div className="eyebrow">A GOOD CONVERSATION STARTS HERE</div>
      <h1>
        Your <em>connections.</em>
      </h1>
      <p className="sr-only" role="status" aria-live="polite">
        {loading
          ? "Loading conversations."
          : error
            ? "Conversations could not be refreshed."
            : `${items.length} conversations loaded.`}
      </p>
      <div className="actions">
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setRefresh((value) => value + 1);
          }}
        >
          {error ? "Try again" : "Refresh conversations"}
        </button>
      </div>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="activity" aria-busy={loading}>
        {items.map((item) => (
          <button
            key={item.id}
            aria-label={`Open conversation with ${item.first_name}${item.unread > 0 ? `, ${item.unread} unread messages` : ""}`}
            onClick={() => void run(() => openProfile(item.id))}
          >
            {item.photo_id ? (
              <img
                className="avatar"
                src={"/api/v1/photos/" + item.photo_id}
                alt=""
              />
            ) : (
              <MessageCircle size={26} />
            )}
            <span>
              <strong>{item.first_name}</strong>
              <br />
              {item.preview || "You connected. Say hello!"}
            </span>
            {item.unread > 0 && (
              <span className="badge">
                <span className="sr-only">Unread messages: </span>
                {item.unread} unread
              </span>
            )}
          </button>
        ))}
      </div>
      {!loading && !items.length && !error && (
        <div className="empty">
          <MessageCircle size={40} />
          <h2>Room for a new hello</h2>
          <p>
            When you both express interest, your connection will appear here.
          </p>
        </div>
      )}
    </>
  );
}
