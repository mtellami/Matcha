import { useEffect, useState } from "react";
import {
  CalendarDays,
  Check,
  Clock3,
  HeartHandshake,
  MapPin,
  MessageCircle,
  MessageSquare,
  X,
} from "lucide-react";
import { api } from "../../shared/api";
import { UiButton } from "../../shared/UiButton";
import type { DatePlan, Me, Runner } from "../../shared/types";

type DatesProps = {
  me: Me;
  run: Runner;
  revision: number;
  changed: () => Promise<void>;
  notify: (message: string) => void;
  busy: boolean;
  openProfile: (id: number) => Promise<void>;
  openMessage: (id: number) => void;
};

type DateFilter = "scheduled" | "invitations" | "past";

function personName(plan: DatePlan) {
  return (
    [plan.other_first_name, plan.other_last_name].filter(Boolean).join(" ") ||
    plan.other_username ||
    "Your connection"
  );
}

function initials(plan: DatePlan) {
  const value = [plan.other_first_name, plan.other_last_name]
    .filter(Boolean)
    .map((name) => name?.[0])
    .join("");
  return (value || plan.other_username?.slice(0, 2) || "?").toUpperCase();
}

export function Dates({
  me,
  run,
  revision,
  changed,
  notify,
  busy,
  openProfile,
  openMessage,
}: DatesProps) {
  const [events, setEvents] = useState<DatePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<DateFilter | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<{ events: DatePlan[] }>("/dates")
      .then(({ events: next }) => {
        if (active) {
          setEvents(next);
          setError("");
        }
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "Could not load dates.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);

  async function respond(plan: DatePlan, response: "accepted" | "declined") {
    await api(`/dates/${plan.id}/rsvp`, "POST", { response });
    const { events: next } = await api<{ events: DatePlan[] }>("/dates");
    setEvents(next);
    await changed();
    notify(
      response === "accepted" ? "Date plan accepted." : "Invitation declined.",
    );
  }

  async function cancelPlan(plan: DatePlan) {
    await api(`/dates/${plan.id}/cancel`, "POST");
    const { events: next } = await api<{ events: DatePlan[] }>("/dates");
    setEvents(next);
    await changed();
    notify("Date plan cancelled.");
  }

  const now = Date.now();
  const scheduled = events.filter(
    (plan) => plan.status === "accepted" && Date.parse(plan.starts_at) >= now,
  );
  const invitations = events.filter((plan) => plan.status === "pending");
  const past = events.filter(
    (plan) =>
      Date.parse(plan.starts_at) < now ||
      plan.status === "declined" ||
      plan.status === "cancelled",
  );
  const activeFilter =
    filter ??
    (invitations.length
      ? "invitations"
      : scheduled.length
        ? "scheduled"
        : past.length
          ? "past"
          : "scheduled");
  const filteredEvents = events.filter((plan) => {
    if (activeFilter === "scheduled")
      return plan.status === "accepted" && Date.parse(plan.starts_at) >= now;
    if (activeFilter === "invitations") return plan.status === "pending";
    return (
      Date.parse(plan.starts_at) < now ||
      plan.status === "declined" ||
      plan.status === "cancelled"
    );
  });
  const filters: {
    id: DateFilter;
    label: string;
    count: number;
  }[] = [
    { id: "scheduled", label: "Scheduled", count: scheduled.length },
    { id: "invitations", label: "Invitations", count: invitations.length },
    { id: "past", label: "Past", count: past.length },
  ];

  return (
    <section
      className="mx-auto grid w-full max-w-6xl gap-6"
      aria-labelledby="dates-title"
    >
      <header className="flex items-center gap-4 rounded-3xl border border-matcha-border bg-matcha-surface px-5 py-5 shadow-sm sm:px-7 sm:py-6">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-matcha-accent/10 text-matcha-accent sm:size-16">
          <HeartHandshake size={27} aria-hidden="true" />
        </span>
        <div>
          <p className="m-0 text-xs font-bold uppercase tracking-[0.16em] text-matcha-accent">
            Dates
          </p>
          <h1
            id="dates-title"
            className="m-0 mt-1 text-2xl font-bold sm:text-3xl"
          >
            Your date plans
          </h1>
          <p className="m-0 mt-1 text-sm text-matcha-muted sm:text-base">
            Manage your upcoming dates and invitations.
          </p>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="m-0 rounded-xl bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger-text)]"
        >
          {error}
        </p>
      )}
      {loading ? (
        <p
          role="status"
          className="m-0 py-8 text-center text-sm text-matcha-muted"
        >
          Loading your dates…
        </p>
      ) : (
        <>
          <div
            role="group"
            aria-label="Filter date plans"
            className="grid grid-cols-3 gap-1 rounded-full border border-matcha-border bg-matcha-surface p-1.5 shadow-sm sm:gap-2 sm:p-2"
          >
            {filters.map(({ id, label, count }) => {
              const active = activeFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(id)}
                  className={`flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-full px-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent sm:min-h-12 sm:gap-2 sm:px-4 sm:text-sm ${active ? "bg-matcha-accent text-[var(--accent-foreground)] shadow-sm" : "text-matcha-muted hover:bg-matcha-raised hover:text-matcha-text"}`}
                >
                  <span className="truncate">{label}</span>
                  <span
                    className={`min-w-5 rounded-full px-1.5 py-0.5 text-xs ${active ? "bg-[var(--accent-foreground)]/15" : "bg-matcha-raised"}`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {events.length === 0 ? (
            <div className="grid justify-items-center gap-2 rounded-2xl border border-matcha-border bg-matcha-surface px-6 py-12 text-center">
              <CalendarDays
                size={28}
                className="text-matcha-accent"
                aria-hidden="true"
              />
              <h2 className="m-0 text-lg font-semibold">No dates yet</h2>
              <p className="m-0 max-w-sm text-sm text-matcha-muted">
                Date invitations and plans you create with your connections will
                show up here.
              </p>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="grid justify-items-center gap-2 rounded-2xl border border-matcha-border bg-matcha-surface px-6 py-10 text-center">
              <CalendarDays
                size={26}
                className="text-matcha-accent"
                aria-hidden="true"
              />
              <h2 className="m-0 text-lg font-semibold">
                {activeFilter === "scheduled"
                  ? "No scheduled dates yet"
                  : activeFilter === "invitations"
                    ? "No invitations waiting"
                    : "No past dates"}
              </h2>
              <p className="m-0 text-sm text-matcha-muted">
                Choose another filter to see your other plans.
              </p>
            </div>
          ) : (
            <ul className="m-0 grid list-none gap-4 p-0">
              {filteredEvents.map((plan) => {
                const incoming =
                  plan.invitee === me.id && plan.status === "pending";
                const personId = plan.other_user_id;
                const isScheduled = activeFilter === "scheduled";
                const isPast = activeFilter === "past";
                const startsAt = new Date(plan.starts_at);
                const day = new Intl.DateTimeFormat([], {
                  day: "numeric",
                }).format(startsAt);
                const month = new Intl.DateTimeFormat([], {
                  month: "short",
                }).format(startsAt);
                const time = new Intl.DateTimeFormat([], {
                  hour: "numeric",
                  minute: "2-digit",
                }).format(startsAt);
                return (
                  <li
                    key={plan.id}
                    className="rounded-3xl border border-matcha-border bg-matcha-surface p-4 shadow-sm sm:p-6"
                  >
                    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-4 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-x-7">
                      <div className="grid size-16 place-content-center rounded-2xl bg-matcha-accent/10 text-center text-matcha-accent sm:size-[88px]">
                        <span className="text-2xl font-bold leading-none sm:text-3xl">
                          {day}
                        </span>
                        <span className="mt-1 text-xs font-semibold sm:text-sm">
                          {month}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-start gap-3">
                          <h2 className="m-0 min-w-0 flex-1 break-words text-lg font-bold leading-snug text-matcha-text sm:text-2xl">
                            {plan.title}
                          </h2>
                          {!isPast && (
                            <div className="flex shrink-0 items-center gap-2">
                              {incoming ? (
                                <>
                                  <UiButton
                                    type="button"
                                    disabled={busy}
                                    variant="primary"
                                    aria-label={`Accept ${plan.title} invitation`}
                                    title="Accept invitation"
                                    className="!grid size-10 min-h-10 min-w-10 place-items-center rounded-full !border-[var(--accent)] !bg-[var(--accent)] p-0 !text-[var(--accent-foreground)] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent"
                                    onClick={() =>
                                      void run(() => respond(plan, "accepted"))
                                    }
                                  >
                                    <Check size={18} aria-hidden="true" />
                                  </UiButton>
                                  <UiButton
                                    type="button"
                                    disabled={busy}
                                    aria-label={`Decline ${plan.title} invitation`}
                                    title="Decline invitation"
                                    className="grid size-10 min-h-10 min-w-10 place-items-center rounded-full border border-matcha-border bg-transparent p-0 text-matcha-text hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent"
                                    onClick={() =>
                                      void run(() => respond(plan, "declined"))
                                    }
                                  >
                                    <X size={18} aria-hidden="true" />
                                  </UiButton>
                                </>
                              ) : (
                                <>
                                  {isScheduled && (
                                    <UiButton
                                      type="button"
                                      disabled={!personId}
                                      aria-label={`Message ${personName(plan)}`}
                                      title={`Message ${personName(plan)}`}
                                      className="grid size-10 min-h-10 min-w-10 shrink-0 place-items-center rounded-full border border-matcha-border bg-transparent p-0 text-matcha-muted hover:bg-matcha-raised hover:text-matcha-accent"
                                      onClick={() =>
                                        personId && openMessage(personId)
                                      }
                                    >
                                      <MessageCircle
                                        size={18}
                                        aria-hidden="true"
                                      />
                                    </UiButton>
                                  )}
                                  {(isScheduled || plan.creator === me.id) && (
                                    <UiButton
                                      type="button"
                                      disabled={busy}
                                      aria-label={`Cancel ${plan.title}`}
                                      title={
                                        isScheduled
                                          ? "Cancel date plan"
                                          : "Cancel invitation"
                                      }
                                      className="grid size-10 min-h-10 min-w-10 shrink-0 place-items-center rounded-full border border-matcha-border bg-transparent p-0 text-matcha-muted hover:bg-[var(--danger-bg)] hover:text-[var(--danger-text)]"
                                      onClick={() =>
                                        void run(() => cancelPlan(plan))
                                      }
                                    >
                                      <X size={18} aria-hidden="true" />
                                    </UiButton>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-matcha-muted sm:text-base">
                          <span className="flex items-center gap-2">
                            <Clock3
                              size={17}
                              className="text-matcha-muted"
                              aria-hidden="true"
                            />
                            {time}
                          </span>
                          <span className="flex min-w-0 items-center gap-2">
                            <MapPin
                              size={17}
                              className="shrink-0 text-matcha-muted"
                              aria-hidden="true"
                            />
                            <span className="truncate" title={plan.location}>
                              {plan.location}
                            </span>
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={!personId}
                          aria-label={`View ${personName(plan)}'s profile`}
                          onClick={() =>
                            personId && void run(() => openProfile(personId))
                          }
                          className="mt-3 flex max-w-full items-center gap-3 rounded-full p-0.5 pr-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent disabled:cursor-default"
                        >
                          <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-matcha-accent/15 text-xs font-semibold text-matcha-accent">
                            {plan.other_photo_id ? (
                              <img
                                src={`/api/v1/photos/${plan.other_photo_id}`}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : (
                              initials(plan)
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs leading-tight text-matcha-muted">
                              {activeFilter === "invitations"
                                ? incoming
                                  ? "Invited by"
                                  : "Invitation sent to"
                                : "With"}
                            </span>
                            <span className="block truncate text-sm font-medium leading-tight text-matcha-text">
                              {personName(plan)}
                            </span>
                          </span>
                        </button>
                        {plan.details && (
                          <p className="mb-0 mt-4 flex items-center gap-3 rounded-2xl bg-matcha-raised px-4 py-3 text-sm leading-relaxed text-matcha-text sm:text-base">
                            <MessageSquare
                              size={17}
                              className="shrink-0 text-matcha-accent"
                              aria-hidden="true"
                            />
                            <span className="min-w-0 break-words">
                              {plan.details}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
