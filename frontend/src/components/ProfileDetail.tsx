import { useEffect, useRef, useState } from "react";
import { Heart, Leaf, MessageCircle } from "lucide-react";
import { api, ApiError } from "../api";
import { messageUpdates, mergeMessages } from "../chat";
import type { Message, Profile, Runner } from "../types";

type Status = Pick<
  Profile,
  "online" | "last_seen" | "connected" | "liked" | "likes_you"
>;
export function ProfileDetail({
  revision,
  person,
  myId,
  back,
  run,
  changed,
  busy,
}: {
  revision: number;
  person: Profile;
  myId: number;
  back: () => void;
  run: Runner;
  changed: () => Promise<void>;
  busy: boolean;
}) {
  const [profile, setProfile] = useState(person),
    [messages, setMessages] = useState<Message[]>([]),
    [next, setNext] = useState<number | null>(null),
    [error, setError] = useState(""),
    [unavailable, setUnavailable] = useState(false),
    [activePhoto, setActivePhoto] = useState(person.photos?.[0]?.id);
  const [draft, setDraft] = useState("");
  const ownProfile = person.id === myId;
  const [bottomVisible, setBottomVisible] = useState(false);
  const bottom = useRef<HTMLDivElement>(null),
    messageKey = useRef<{ body: string; key: string } | null>(null);
  const lastId = messages.at(-1)?.id;
  const historyInitialized = useRef(false);
  const latestCursor = useRef<number | null>(null);
  const pollNow = useRef<() => Promise<void>>(async () => {});
  const atBottom = useRef(false);
  atBottom.current = bottomVisible;
  const [visible, setVisible] = useState(
    document.visibilityState === "visible",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!bottom.current) return;
    const observer = new IntersectionObserver((entries) =>
      setBottomVisible(entries[0].isIntersecting),
    );
    observer.observe(bottom.current);
    return () => observer.disconnect();
  }, [profile.connected]);
  useEffect(() => {
    if (!lastId || !bottomVisible || !profile.connected || !visible) return;
    void api(`/conversations/${person.id}/read`, "POST", { through_id: lastId })
      .then(changed)
      .catch(() => {});
  }, [lastId, bottomVisible, profile.connected, person.id, changed, visible]);
  useEffect(() => {
    if (ownProfile) return;
    let active = true,
      inFlight = false,
      queued = false;
    const controller = new AbortController();
    async function poll() {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      try {
        const status = await api<Status>(
          `/profiles/${person.id}/status`,
          "GET",
          undefined,
          controller.signal,
        );
        if (!active) return;
        setProfile((current) => ({ ...current, ...status }));
        setError("");
        if (!status.connected) {
          setMessages([]);
          setNext(null);
          historyInitialized.current = false;
          latestCursor.current = null;
          return;
        }
        const first = !historyInitialized.current;
        const response = await messageUpdates(
          person.id,
          latestCursor.current,
          controller.signal,
        );
        if (!active) return;
        setMessages((current) => mergeMessages(current, response.messages));
        latestCursor.current = response.latest;
        if (first) {
          setNext(response.next_before);
          historyInitialized.current = true;
        }
        if (first || (response.messages.length && atBottom.current))
          setTimeout(
            () => bottom.current?.scrollIntoView({ block: "nearest" }),
            0,
          );
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
            setUnavailable(e.status === 404);
            setProfile((p) => ({ ...p, connected: false }));
            setMessages([]);
            historyInitialized.current = false;
            latestCursor.current = null;
          }
        }
      } finally {
        inFlight = false;
        if (active && queued) {
          queued = false;
          void poll();
        }
      }
    }
    pollNow.current = poll;
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      pollNow.current = async () => {};
    };
  }, [person.id, ownProfile]);
  useEffect(() => {
    void pollNow.current();
  }, [revision]);
  async function relationship() {
    await api(`/profiles/${person.id}/like`, profile.liked ? "DELETE" : "POST");
    const status = await api<Status>(`/profiles/${person.id}/status`);
    setProfile((current) => ({ ...current, ...status }));
    await changed();
  }
  async function send() {
    const body = draft.trim();
    if (!body) return;
    if (messageKey.current?.body !== body)
      messageKey.current = { body, key: crypto.randomUUID() };
    await api(`/conversations/${person.id}/messages`, "POST", {
      body,
      client_id: messageKey.current.key,
    });
    setDraft("");
    messageKey.current = null;
    await pollNow.current();
    setTimeout(
      () =>
        bottom.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        }),
      0,
    );
    await changed();
  }
  return (
    <>
      <button className="back" onClick={back}>
        {ownProfile ? "← Back to editing" : "← Back"}
      </button>
      {ownProfile && <p className="preview-note">Your public profile · This is what other members can see. Save changes in your profile editor before previewing.</p>}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {!unavailable && (
        <section className="detail">
          <div>
            <div className="portrait">
              {activePhoto ? (
                <img
                  src={"/api/v1/photos/" + activePhoto}
                  alt={profile.first_name}
                />
              ) : (
                <Leaf size={100} />
              )}
            </div>
            {(profile.photos?.length || 0) > 1 && (
              <div className="photo-row gallery">
                {profile.photos?.map((photo) => (
                  <button
                    aria-label="View photo"
                    aria-pressed={activePhoto === photo.id}
                    key={photo.id}
                    onClick={() => setActivePhoto(photo.id)}
                  >
                    <img src={"/api/v1/photos/" + photo.id} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="eyebrow">
              {profile.city} · FAME {profile.fame}
            </div>
            <h1>
              {profile.first_name}
              {profile.age !== null && ", " + profile.age}
            </h1>
            <p className="presence">
              {profile.online
                ? "● Online now"
                : profile.last_seen
                  ? "Last connected " +
                    new Date(profile.last_seen).toLocaleString()
                  : "Offline"}
            </p>
            <p>
              {profile.gender} · Interested in {profile.preferences.join(", ")}
            </p>
            <p className="biography">{profile.bio}</p>
            <div className="tags">
              {profile.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </div>
            {!ownProfile && <p>
              {profile.connected
                ? "You’re connected ✨"
                : profile.likes_you
                  ? "They’re interested in you"
                  : ""}
            </p>}
            {!ownProfile && <div className="actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() => void run(relationship)}
              >
                <Heart size={18} />
                {profile.liked ? "Remove interest" : "I’m interested"}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`/profiles/${person.id}/block`, "POST");
                    await changed();
                    back();
                  })
                }
              >
                Block
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`/profiles/${person.id}/reports`, "POST", {
                      reason: "Suspected fake account",
                    });
                    setError("Your report has been received.");
                  })
                }
              >
                Report fake
              </button>
            </div>}
            {profile.connected && (
              <section className="chat">
                <h2>
                  <MessageCircle size={20} /> Your conversation
                </h2>
                {next && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const response = await api<{
                          messages: Message[];
                          next_before: number | null;
                        }>(
                          `/conversations/${person.id}/messages?before=${next}`,
                        );
                        setMessages((items) =>
                          mergeMessages(items, response.messages),
                        );
                        setNext(response.next_before);
                      })
                    }
                  >
                    Older messages
                  </button>
                )}
                <div className="messages" aria-label="Messages">
                  {messages.map((message) => (
                    <div
                      className={message.actor === myId ? "sent" : "received"}
                      key={message.id}
                    >
                      {message.body}
                      <small>
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </div>
                  ))}
                  <div ref={bottom} />
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(send);
                  }}
                >
                  <input
                    name="body"
                    disabled={busy}
                    aria-label="Message"
                    placeholder="Start with hello…"
                    maxLength={4000}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    required
                  />
                  <button className="primary" disabled={busy || !draft.trim()}>
                    Send
                  </button>
                </form>
              </section>
            )}
          </div>
        </section>
      )}
    </>
  );
}
