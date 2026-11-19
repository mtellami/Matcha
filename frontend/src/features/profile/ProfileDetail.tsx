import { UiInput, UiTextarea } from "../../shared/UiInput";
import { UiButton } from "../../shared/UiButton";
import { Dropdown, Tooltip } from "@heroui/react";
import { useEffect, useState } from "react";
import {
  Ban,
  CalendarDays,
  Check,
  ChevronLeft,
  Flag,
  Heart,
  Leaf,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Pencil,
  Star,
  Video,
  X,
} from "lucide-react";
import { api, ApiError } from "../../shared/api";
import type { DatePlan, Profile, Runner } from "../../shared/types";

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
  editProfile,
  back,
  run,
  changed,
  notify,
  busy,
  startCall,
  openMessage,
}: {
  revision: number;
  person: Profile;
  myId: number;
  editProfile: () => void;
  back: () => void;
  run: Runner;
  changed: () => Promise<void>;
  notify: (message: string) => void;
  busy: boolean;
  startCall: (media: "audio" | "video") => Promise<void>;
  openMessage: (id: number) => void;
}) {
  const [profile, setProfile] = useState(person),
    [error, setError] = useState(""),
    [unavailable, setUnavailable] = useState(false),
    [activePhoto, setActivePhoto] = useState(person.photos?.[0]?.id);
  const [datePlans, setDatePlans] = useState<DatePlan[]>([]);
  const [dateError, setDateError] = useState("");
  const [datesLoading, setDatesLoading] = useState(false);
  const ownProfile = person.id === myId;
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
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
            setUnavailable(e.status === 404);
            setProfile((p) => ({ ...p, connected: false }));
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
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [person.id, ownProfile]);
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
  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        <UiButton
          className="min-h-10 justify-self-start rounded-full border-transparent bg-transparent px-2 text-matcha-text hover:bg-matcha-raised"
          onClick={back}
        >
          <ChevronLeft size={18} aria-hidden="true" />
          <span>Back</span>
        </UiButton>
        {ownProfile && (
          <UiButton
            className="ml-auto shrink-0 rounded-full"
            onClick={editProfile}
          >
            <Pencil size={16} aria-hidden="true" /> Edit profile
          </UiButton>
        )}
      </div>
      {error && (
        <p
          className="mb-6 flex justify-between rounded-lg bg-[var(--danger-bg)] p-[15px] text-[var(--danger-text)]"
          role="alert"
        >
          {error}
        </p>
      )}
      {!unavailable && (
        <section className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,.98fr)] lg:gap-12">
          <div className="min-w-0">
            <div className="relative mx-auto aspect-[4/5] w-full max-w-[560px] overflow-hidden rounded-[28px] bg-[var(--avatar-bg)] text-matcha-accent shadow-[0_24px_64px_var(--shadow)]">
              {activePhoto ? (
                <img
                  className="absolute inset-0 size-full object-cover"
                  src={"/api/v1/photos/" + activePhoto}
                  alt={`${profile.first_name}’s profile photo`}
                />
              ) : (
                <div className="grid size-full place-items-center">
                  <Leaf size={100} />
                </div>
              )}
            </div>
            {(profile.photos?.length || 0) > 1 && (
              <div className="mx-auto mt-4 flex w-full max-w-[560px] flex-wrap gap-2.5">
                {profile.photos?.map((photo, index) => (
                  <button
                    type="button"
                    aria-label={`View ${profile.first_name}’s photo ${index + 1} of ${profile.photos?.length}`}
                    aria-pressed={activePhoto === photo.id}
                    key={photo.id}
                    onClick={() => setActivePhoto(photo.id)}
                    className={`relative block size-[76px] shrink-0 overflow-hidden rounded-2xl border-2 bg-matcha-surface p-0 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent ${activePhoto === photo.id ? "border-matcha-accent" : "border-transparent opacity-75 hover:opacity-100"}`}
                  >
                    <img
                      className="absolute inset-0 block size-full object-cover"
                      src={"/api/v1/photos/" + photo.id}
                      alt=""
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-w-0 lg:pt-2">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-matcha-muted">
              {profile.city && (
                <span className="inline-flex items-center gap-2">
                  <MapPin size={17} className="text-matcha-accent" />
                  {profile.city}
                </span>
              )}
              <span
                className={
                  profile.online
                    ? "inline-flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300"
                    : "inline-flex items-center gap-2 text-matcha-muted"
                }
                role="status"
                aria-live="polite"
              >
                <span
                  className={
                    profile.online
                      ? "size-2 rounded-full bg-emerald-500"
                      : "size-2 rounded-full bg-matcha-muted/50"
                  }
                />
                {profile.online
                  ? "Online now"
                  : profile.last_seen
                    ? "Last seen " +
                      new Date(profile.last_seen).toLocaleDateString()
                    : "Offline"}
              </span>
            </div>
            <h1 className="mb-5 mt-5 text-[clamp(3rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-.055em]">
              {profile.first_name}
              {profile.age !== null && (
                <span className="font-serif font-normal italic text-matcha-accent">
                  , {profile.age}
                </span>
              )}
            </h1>
            <div className="flex flex-wrap gap-2">
              {profile.gender && (
                <span className="rounded-full bg-matcha-accent/10 px-4 py-2 text-sm font-medium text-matcha-text">
                  {profile.gender}
                </span>
              )}
              {profile.preferences.map((preference) => (
                <span
                  key={preference}
                  className="rounded-full bg-matcha-accent/10 px-4 py-2 text-sm font-medium text-matcha-text"
                >
                  Interested in {preference.toLowerCase()}
                </span>
              ))}
            </div>
            {!ownProfile && profile.likes_you && !profile.connected && (
              <p className="mb-0 mt-3 text-sm text-matcha-accent">
                They’re interested in you
              </p>
            )}
            {!ownProfile && (
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <UiButton
                  className="min-h-[54px] min-w-[132px] rounded-2xl !border-matcha-accent !bg-matcha-accent px-6 font-semibold !text-matcha-bg hover:!bg-matcha-accent/90"
                  disabled={busy}
                  onClick={() => void run(relationship)}
                >
                  <Heart size={18} />
                  {profile.liked ? "Remove interest" : "Like"}
                </UiButton>
                {profile.connected ? (
                  <UiButton
                    className="min-h-[54px] min-w-[132px] rounded-2xl px-6 font-semibold"
                    onClick={() => openMessage(person.id)}
                  >
                    <MessageCircle size={18} />
                    Message
                  </UiButton>
                ) : (
                  <Tooltip>
                    <Tooltip.Trigger>
                      <span tabIndex={0}>
                        <UiButton
                          className="min-h-[54px] min-w-[132px] rounded-2xl px-6 font-semibold"
                          disabled
                        >
                          <MessageCircle size={18} />
                          Message
                        </UiButton>
                      </span>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      Like each other to connect. Messaging is available after
                      you connect.
                    </Tooltip.Content>
                  </Tooltip>
                )}
                <Dropdown>
                  <Dropdown.Trigger
                    aria-label="More profile actions"
                    className="grid size-[54px] shrink-0 place-items-center rounded-2xl border border-matcha-border bg-matcha-surface text-matcha-text hover:bg-matcha-raised"
                  >
                    <MoreHorizontal size={21} />
                  </Dropdown.Trigger>
                  <Dropdown.Popover placement="bottom end">
                    <Dropdown.Menu
                      className="min-w-48 p-1.5"
                      onAction={(action) => {
                        if (action === "block") {
                          void run(async () => {
                            await api(`/profiles/${person.id}/block`, "POST");
                            await changed();
                            back();
                          });
                        }
                        if (action === "report") {
                          void run(async () => {
                            await api(
                              `/profiles/${person.id}/reports`,
                              "POST",
                              { reason: "Suspected fake account" },
                            );
                            notify("Your report has been received. Thank you.");
                          });
                        }
                      }}
                    >
                      <Dropdown.Item
                        id="block"
                        className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-matcha-text"
                      >
                        <Ban size={17} /> Block
                      </Dropdown.Item>
                      <Dropdown.Item
                        id="report"
                        className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-matcha-text"
                      >
                        <Flag size={17} /> Report fake
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
              </div>
            )}
            <div className="mt-8 border-t border-matcha-border pt-6">
              <h2 className="m-0 text-xs font-bold uppercase tracking-[2px] text-matcha-muted">
                About
              </h2>
              <p className="mb-0 mt-3 whitespace-pre-wrap break-words text-lg leading-relaxed text-matcha-text">
                {profile.bio || "This person hasn’t added a bio yet."}
              </p>
            </div>
            {profile.tags.length > 0 && (
              <div className="mt-7">
                <h2 className="m-0 text-xs font-bold uppercase tracking-[2px] text-matcha-muted">
                  Interests
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {profile.tags.map((tag) => (
                    <span
                      className="rounded-full border border-matcha-border bg-matcha-accent/5 px-4 py-2 text-sm font-semibold text-matcha-accent"
                      key={tag}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-7 inline-flex items-center gap-3 rounded-2xl border border-matcha-border bg-matcha-surface px-4 py-3">
              <span className="grid size-11 place-items-center rounded-xl bg-matcha-accent/10 text-matcha-accent">
                <Star size={21} />
              </span>
              <span>
                <span className="block text-xs text-matcha-muted">
                  Fame rating
                </span>
                <strong className="block text-xl leading-tight text-matcha-text">
                  {profile.fame}
                </strong>
              </span>
            </div>
            {profile.connected && (
              <section
                id="profile-conversation"
                className="chat mt-10 scroll-mt-32 border-t border-matcha-border pt-6"
              >
                <h2 className="m-0 text-xl">Stay connected</h2>
                <div className="my-3 flex flex-wrap items-center gap-2">
                  <UiButton
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => startCall("audio"))}
                  >
                    <Phone size={16} /> Audio call
                  </UiButton>
                  <UiButton
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => startCall("video"))}
                  >
                    <Video size={16} /> Video call
                  </UiButton>
                  <small className="basis-full text-xs leading-relaxed text-matcha-muted">
                    Your browser will ask for microphone or camera access. Calls
                    connect peer to peer, so your network address may be visible
                    to the other caller.
                  </small>
                </div>
                <section
                  className="my-5 grid min-w-0 gap-4 rounded-2xl border border-matcha-border bg-matcha-surface p-4 sm:p-5"
                  aria-labelledby="date-planner-title"
                >
                  <div>
                    <h3
                      id="date-planner-title"
                      className="m-0 flex items-center gap-2 text-lg font-semibold"
                    >
                      <CalendarDays size={19} /> Plan a date
                    </h3>
                    <p className="mb-0 mt-1 text-sm leading-relaxed">
                      Pick a place and time together. Only this connection can
                      see the plan.
                    </p>
                  </div>
                  {dateError && (
                    <p
                      className="m-0 text-sm text-[var(--danger-text)]"
                      role="alert"
                    >
                      {dateError}
                    </p>
                  )}
                  {datesLoading ? (
                    <p className="m-0 text-sm text-matcha-muted" role="status">
                      Loading date plans…
                    </p>
                  ) : datePlans.length > 0 ? (
                    <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
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
                          <li
                            className="flex min-w-0 flex-col gap-3 rounded-xl border border-matcha-border bg-matcha-bg p-3 sm:flex-row sm:items-center sm:justify-between"
                            key={plan.id}
                          >
                            <div className="grid min-w-0 gap-1.5">
                              <strong className="break-words text-sm font-semibold text-matcha-text">
                                {plan.title}
                              </strong>
                              <span className="flex items-center gap-1.5 text-xs text-matcha-muted">
                                <CalendarDays size={14} />
                                {new Date(plan.starts_at).toLocaleString([], {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })}
                              </span>
                              <span className="flex items-center gap-1.5 text-xs text-matcha-muted">
                                <MapPin size={14} /> {plan.location}
                              </span>
                              {plan.details && (
                                <p className="m-0 break-words text-xs leading-relaxed">
                                  {plan.details}
                                </p>
                              )}
                              <small
                                className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${plan.status === "accepted" ? "bg-[var(--success-bg)] text-[var(--success-text)]" : plan.status === "declined" || plan.status === "cancelled" ? "bg-[var(--danger-bg)] text-[var(--danger-text)]" : "bg-matcha-accent/10 text-matcha-accent"}`}
                              >
                                {statusLabel}
                              </small>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                              {plan.status === "pending" &&
                                plan.invitee === myId && (
                                  <>
                                    <UiButton
                                      type="button"
                                      aria-label={`Accept ${plan.title} invitation`}
                                      disabled={busy}
                                      className="min-h-9 rounded-lg px-3 text-xs"
                                      onClick={() =>
                                        void run(() =>
                                          respondToDate(plan.id, "accepted"),
                                        )
                                      }
                                    >
                                      <Check size={16} /> Accept
                                    </UiButton>
                                    <UiButton
                                      type="button"
                                      aria-label={`Decline ${plan.title} invitation`}
                                      disabled={busy}
                                      className="min-h-9 rounded-lg px-3 text-xs"
                                      onClick={() =>
                                        void run(() =>
                                          respondToDate(plan.id, "declined"),
                                        )
                                      }
                                    >
                                      <X size={16} /> Decline
                                    </UiButton>
                                  </>
                                )}
                              {(plan.status === "pending" ||
                                plan.status === "accepted") && (
                                <UiButton
                                  type="button"
                                  disabled={busy}
                                  className="min-h-9 rounded-lg px-3 text-xs"
                                  onClick={() =>
                                    void run(() => cancelDate(plan.id))
                                  }
                                >
                                  Cancel plan
                                </UiButton>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="m-0 text-sm leading-relaxed text-matcha-muted">
                      No date plans yet. Start with a place you both like.
                    </p>
                  )}
                  <form
                    className="grid min-w-0 gap-3 border-t border-matcha-border pt-4"
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
                    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="grid min-w-0 gap-1.5 text-sm font-medium text-matcha-muted">
                        Plan
                        <UiInput
                          name="title"
                          placeholder="Coffee and a walk"
                          maxLength={100}
                          required
                          className="w-full"
                        />
                      </label>
                      <label className="grid min-w-0 gap-1.5 text-sm font-medium text-matcha-muted">
                        Place
                        <UiInput
                          name="location"
                          placeholder="A café or meeting spot"
                          maxLength={160}
                          required
                          className="w-full"
                        />
                      </label>
                      <label className="grid min-w-0 gap-1.5 text-sm font-medium text-matcha-muted">
                        Date and time
                        <UiInput
                          name="starts_at"
                          type="datetime-local"
                          min={dateMin}
                          max={dateMax}
                          required
                          className="w-full"
                        />
                      </label>
                    </div>
                    <label className="grid min-w-0 gap-1.5 text-sm font-medium text-matcha-muted">
                      A note (optional)
                      <UiTextarea
                        name="details"
                        placeholder="Anything useful to know?"
                        maxLength={500}
                        rows={2}
                        className="w-full"
                      />
                    </label>
                    <UiButton
                      variant="primary"
                      className="min-h-11 w-full rounded-xl !border-matcha-accent !bg-matcha-accent font-semibold !text-[var(--accent-foreground)] hover:!bg-matcha-accent/90 sm:w-fit"
                      disabled={busy}
                    >
                      Send date invitation
                    </UiButton>
                    <small className="text-xs text-matcha-muted">
                      Plans can be scheduled up to 90 days ahead.
                    </small>
                  </form>
                </section>
              </section>
            )}
          </div>
        </section>
      )}
    </>
  );
}
