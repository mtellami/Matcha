import { UiButton } from "../../shared/UiButton";
import {
  CalendarDays,
  Eye,
  Heart,
  Link,
  MailOpen,
  MessageCircle,
  User,
  Unlink,
} from "lucide-react";
import type { Notification, Runner } from "../../shared/types";
import { activityDateLabel, activityDayLabel } from "./date";

const events: Record<string, { text: string; Icon: typeof Heart }> = {
  visit: { text: "viewed your profile", Icon: Eye },
  like: { text: "liked your profile", Icon: Heart },
  match: { text: "connected with you", Icon: Link },
  message: { text: "sent you a message", Icon: MessageCircle },
  disconnect: { text: "removed their interest", Icon: Unlink },
  date_invite: { text: "invited you to plan a date", Icon: CalendarDays },
  date_response: { text: "responded to a date plan", Icon: CalendarDays },
};

export function NotificationList({
  items,
  busy,
  run,
  open,
  markRead,
}: {
  items: Notification[];
  busy: boolean;
  run: Runner;
  open: (item: Notification) => Promise<void>;
  markRead: (item: Notification) => Promise<void>;
}) {
  const groups = items.reduce<{ label: string; items: Notification[] }[]>(
    (result, item) => {
      const label = activityDayLabel(item.created_at);
      const latest = result.at(-1);
      if (latest?.label === label) latest.items.push(item);
      else result.push({ label, items: [item] });
      return result;
    },
    [],
  );

  return (
    <div className="grid gap-5">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h2 className="mb-2 mt-0 text-[11px] font-bold uppercase tracking-[2px] text-matcha-muted">
            {group.label}
          </h2>
          <div className="overflow-hidden rounded-2xl border border-matcha-border bg-matcha-surface">
            {group.items.map((item, index) => {
              const { text, Icon } = events[item.kind] || {
                text: "updated your activity",
                Icon: Heart,
              };
              const displayName =
                [item.first_name, item.last_name].filter(Boolean).join(" ") ||
                item.username;

              return (
                <article
                  className={`flex min-w-0 items-center gap-2.5 px-3 py-3.5 sm:gap-3.5 sm:px-4 ${index ? "border-t border-matcha-border/70" : ""} ${item.is_read ? "bg-matcha-surface" : "bg-matcha-accent/[0.035]"}`}
                  key={item.id}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-matcha-accent sm:gap-4"
                    aria-label={`${item.username} ${text}${item.is_read ? ", read" : ", unread"}`}
                    disabled={busy}
                    onClick={() => void run(() => open(item))}
                  >
                    <span className="relative size-11 shrink-0 sm:size-12">
                      {item.photo_id ? (
                        <img
                          className="size-full rounded-full object-cover"
                          src={`/api/v1/photos/${item.photo_id}`}
                          alt=""
                        />
                      ) : (
                        <span className="grid size-full place-items-center rounded-full bg-matcha-accent/10 text-matcha-accent">
                          <User size={22} aria-hidden="true" />
                        </span>
                      )}
                      <span className="absolute -bottom-0.5 -right-1 grid size-6 place-items-center rounded-full border-2 border-matcha-surface bg-matcha-accent text-white">
                        <Icon size={11} aria-hidden="true" />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug text-matcha-text sm:text-sm">
                        <strong className="font-semibold">{displayName}</strong>{" "}
                        {text}
                      </span>
                      <span className="mt-1 block truncate text-xs text-matcha-muted">
                        @{item.username}
                      </span>
                    </span>
                  </button>
                  <time
                    className="shrink-0 text-[11px] text-matcha-muted sm:text-xs"
                    dateTime={item.created_at}
                  >
                    {activityDateLabel(item.created_at)}
                  </time>
                  {!item.is_read && (
                    <>
                      <UiButton
                        type="button"
                        className="!size-8 !min-h-8 !min-w-8 shrink-0 !rounded-full !p-0 text-matcha-accent"
                        disabled={busy}
                        aria-label={`Mark notification from ${item.username} as read`}
                        title="Mark as read"
                        onClick={() => void run(() => markRead(item))}
                      >
                        <MailOpen size={15} />
                      </UiButton>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
