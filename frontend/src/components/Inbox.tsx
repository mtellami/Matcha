import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { api } from "../api";
import type { Conversation, Runner } from "../types";

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
  }, [revision]);
  return (
    <>
      <div className="eyebrow">A GOOD CONVERSATION STARTS HERE</div>
      <h1>
        Your <em>connections.</em>
      </h1>
      {loading && <p role="status">Loading connections…</p>}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="activity">
        {items.map((item) => (
          <button
            key={item.id}
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
              <span className="badge">{item.unread} unread</span>
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
