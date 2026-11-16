import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  Heart,
  Leaf,
  MapPin,
  MessageCircle,
  Phone,
  Video,
  X,
} from "lucide-react";
import { api, ApiError } from "../../shared/api";
import { messageUpdates, mergeMessages } from "../chat/chat";
import type { DatePlan, Message, Profile, Runner } from "../../shared/types";

function localDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

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
  notify,
  busy,
  startCall,
}: {
  revision: number;
  person: Profile;
  myId: number;
  back: () => void;
  run: Runner;
  changed: () => Promise<void>;
  notify: (message: string) => void;
  busy: boolean;
  startCall: (media: "audio" | "video") => Promise<void>;
}) {
  const [profile, setProfile] = useState(person),
    [messages, setMessages] = useState<Message[]>([]),
    [next, setNext] = useState<number | null>(null),
    [error, setError] = useState(""),
    [unavailable, setUnavailable] = useState(false),
    [activePhoto, setActivePhoto] = useState(person.photos?.[0]?.id);
  const [draft, setDraft] = useState("");
  const [datePlans, setDatePlans] = useState<DatePlan[]>([]);
  const [dateError, setDateError] = useState("");
  const [datesLoading, setDatesLoading] = useState(false);
  const ownProfile = person.id === myId;
  const [visibleMessage, setVisibleMessage] = useState<number | null>(null);
  const bottom = useRef<HTMLDivElement>(null),
    readMarker = useRef<HTMLElement>(null),
    messageKey = useRef<{ body: string; key: string } | null>(null);
  const lastId = messages.at(-1)?.id;
  const bottomVisible = lastId !== undefined && visibleMessage === lastId;
  const historyInitialized = useRef(false);
  const latestCursor = useRef<number | null>(null);
  const acknowledgedThrough = useRef<number | null>(null);
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
    if (!readMarker.current || !lastId) return;
    const observer = new IntersectionObserver(
      (entries) =>
        setVisibleMessage(
          entries[0].isIntersecting && entries[0].intersectionRatio >= 1
            ? lastId
            : null,
        ),
      { threshold: 1 },
    );
    observer.observe(readMarker.current);
    return () => observer.disconnect();
  }, [profile.connected, lastId]);
  useEffect(() => {
    if (!lastId || !bottomVisible || !profile.connected || !visible) return;
    let active = true,
      inFlight = false;
    async function acknowledge() {
      if (inFlight || acknowledgedThrough.current === lastId) return;
      inFlight = true;
      try {
        await api(
          `/conversations/${person.id}/read`,
          "POST",
          { through_id: lastId },
          undefined,
          4000,
        );
        if (active) {
          acknowledgedThrough.current = lastId ?? null;
          await changed();
        }
      } catch {
        // Retry while the last message is still visible after a transient failure.
      } finally {
        inFlight = false;
      }
    }
    void acknowledge();
    const timer = setInterval(acknowledge, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
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
          4000,
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
  useEffect(() => {
    if (!profile.connected) {
      setDatePlans([]);
      return;
    }
    let active = true;
    setDatesLoading(true);
    api<{ events: DatePlan[] }>(`/conversations/${person.id}/dates`)
      .then((response) => {
        if (active) {
          setDatePlans(response.events);
          setDateError("");
        }
      })
      .catch((error) => {
        if (active) setDateError((error as Error).message);
      })
      .finally(() => {
        if (active) setDatesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [person.id, profile.connected, revision]);

  async function refreshDatePlans() {
    const response = await api<{ events: DatePlan[] }>(
      `/conversations/${person.id}/dates`,
    );
    setDatePlans(response.events);
  }

  async function respondToDate(
    eventId: number,
    response: "accepted" | "declined",
  ) {
    await api(`/dates/${eventId}/rsvp`, "POST", { response });
    await refreshDatePlans();
    notify(
      response === "accepted" ? "Date plan confirmed" : "Invitation declined",
    );
  }

  async function cancelDate(eventId: number) {
    await api(`/dates/${eventId}/cancel`, "POST");
    await refreshDatePlans();
    notify("Date plan cancelled");
  }

  const dateMin = localDateTime(new Date(Date.now() + 10 * 60_000));
  const dateMax = localDateTime(new Date(Date.now() + 90 * 24 * 60 * 60_000));
  async function relationship() {
    await api(
      `/profiles/${person.id}/like`,
      profile.liked ? "DELETE" : "POST",
      undefined,
      undefined,
      8000,
    );
    const status = await api<Status>(
      `/profiles/${person.id}/status`,
      "GET",
      undefined,
      undefined,
      4000,
    );
    setProfile((current) => ({ ...current, ...status }));
    await changed();
  }
  async function send() {
    const body = draft.trim();
    if (!body) return;
    if (messageKey.current?.body !== body)
      messageKey.current = { body, key: crypto.randomUUID() };
    await api(
      `/conversations/${person.id}/messages`,
      "POST",
      {
        body,
        client_id: messageKey.current.key,
      },
      undefined,
      8000,
    );
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
      {ownProfile && (
        <p className="preview-note">
          Your public profile · This is what other members can see. Save changes
          in your profile editor before previewing.
        </p>
      )}
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
                  alt={`${profile.first_name}’s profile photo`}
                />
              ) : (
                <Leaf size={100} />
              )}
            </div>
            {(profile.photos?.length || 0) > 1 && (
              <div className="photo-row gallery">
                {profile.photos?.map((photo, index) => (
                  <button
                    aria-label={`View ${profile.first_name}’s photo ${index + 1} of ${profile.photos?.length}`}
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
            <p className="presence" role="status" aria-live="polite">
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
            {!ownProfile && (
              <p>
                {profile.connected
                  ? "You’re connected ✨"
                  : profile.likes_you
                    ? "They’re interested in you"
                    : ""}
              </p>
            )}
            {!ownProfile && (
              <div className="actions">
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
                      notify("Your report has been received. Thank you.");
                    })
                  }
                >
                  Report fake
                </button>
              </div>
            )}
            {profile.connected && (
              <section className="chat">
                <h2>
                  <MessageCircle size={20} /> Your conversation
                </h2>
                <div className="call-start-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => startCall("audio"))}
                  >
                    <Phone size={16} /> Audio call
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => startCall("video"))}
                  >
                    <Video size={16} /> Video call
                  </button>
                  <small>
                    Your browser will ask for microphone or camera access. Calls
                    connect peer to peer, so your network address may be visible
                    to the other caller.
                  </small>
                </div>
                <section
                  className="date-planner"
                  aria-labelledby="date-planner-title"
                >
                  <div className="date-planner-heading">
                    <h3 id="date-planner-title">
                      <CalendarDays size={19} /> Plan a date
                    </h3>
                    <p>
                      Pick a place and time together. Only this connection can
                      see the plan.
                    </p>
                  </div>
                  {dateError && (
                    <p className="date-error" role="alert">
                      {dateError}
                    </p>
                  )}
                  {datesLoading ? (
                    <p role="status">Loading date plans…</p>
                  ) : datePlans.length > 0 ? (
                    <ul className="date-plan-list">
                      {datePlans.map((plan) => {
                        const statusLabel =
                          plan.status === "pending"
                            ? plan.creator === myId
                              ? "Waiting for a reply"
                              : "Invitation"
                            : plan.status === "accepted"
                              ? "Confirmed"
                              : plan.status === "declined"
                                ? "Declined"
                                : "Cancelled";
                        return (
                          <li className="date-plan" key={plan.id}>
                            <div className="date-plan-copy">
                              <strong>{plan.title}</strong>
                              <span>
                                <CalendarDays size={14} />
                                {new Date(plan.starts_at).toLocaleString([], {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })}
                              </span>
                              <span>
                                <MapPin size={14} /> {plan.location}
                              </span>
                              {plan.details && <p>{plan.details}</p>}
                              <small className={`date-status ${plan.status}`}>
                                {statusLabel}
                              </small>
                            </div>
                            <div className="date-plan-actions">
                              {plan.status === "pending" &&
                                plan.invitee === myId && (
                                  <>
                                    <button
                                      type="button"
                                      aria-label={`Accept ${plan.title} invitation`}
                                      disabled={busy}
                                      onClick={() =>
                                        void run(() =>
                                          respondToDate(plan.id, "accepted"),
                                        )
                                      }
                                    >
                                      <Check size={16} /> Accept
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Decline ${plan.title} invitation`}
                                      disabled={busy}
                                      onClick={() =>
                                        void run(() =>
                                          respondToDate(plan.id, "declined"),
                                        )
                                      }
                                    >
                                      <X size={16} /> Decline
                                    </button>
                                  </>
                                )}
                              {(plan.status === "pending" ||
                                plan.status === "accepted") && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(() => cancelDate(plan.id))
                                  }
                                >
                                  Cancel plan
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="date-empty">
                      No date plans yet. Start with a place you both like.
                    </p>
                  )}
                  <form
                    className="date-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const values = new FormData(form);
                      void run(async () => {
                        await api(`/conversations/${person.id}/dates`, "POST", {
                          title: values.get("title"),
                          location: values.get("location"),
                          starts_at: new Date(
                            String(values.get("starts_at")),
                          ).toISOString(),
                          details: values.get("details") || "",
                        });
                        form.reset();
                        await refreshDatePlans();
                        notify("Date invitation sent");
                      });
                    }}
                  >
                    <div className="date-form-grid">
                      <label>
                        Plan
                        <input
                          name="title"
                          placeholder="Coffee and a walk"
                          maxLength={100}
                          required
                        />
                      </label>
                      <label>
                        Place
                        <input
                          name="location"
                          placeholder="A café or meeting spot"
                          maxLength={160}
                          required
                        />
                      </label>
                      <label>
                        Date and time
                        <input
                          name="starts_at"
                          type="datetime-local"
                          min={dateMin}
                          max={dateMax}
                          required
                        />
                      </label>
                    </div>
                    <label>
                      A note (optional)
                      <textarea
                        name="details"
                        placeholder="Anything useful to know?"
                        maxLength={500}
                        rows={2}
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      Send date invitation
                    </button>
                    <small>Plans can be scheduled up to 90 days ahead.</small>
                  </form>
                </section>
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
                          "GET",
                          undefined,
                          undefined,
                          4000,
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
                <div
                  className="messages"
                  role="log"
                  aria-label={`Conversation with ${profile.first_name}`}
                  aria-live="polite"
                  aria-relevant="additions text"
                >
                  {messages.map((message) => (
                    <div
                      className={message.actor === myId ? "sent" : "received"}
                      key={message.id}
                      data-message-id={message.id}
                    >
                      <span className="sr-only">
                        {message.actor === myId
                          ? "You sent: "
                          : `${profile.first_name} sent: `}
                      </span>
                      {message.body}
                      <small
                        ref={message.id === lastId ? readMarker : undefined}
                      >
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
