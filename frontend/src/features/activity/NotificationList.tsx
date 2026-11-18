import { UiButton } from "../../shared/UiButton";
import {
  CalendarDays,
  Eye,
  Heart,
  Link,
  MessageCircle,
  Unlink,
} from "lucide-react";
import type { Notification, Runner } from "../../shared/types";

const events: Record<string, { text: string; Icon: typeof Heart }> = {
  visit: { text: "viewed your profile", Icon: Eye },
  like: { text: "is interested in you", Icon: Heart },
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
  return (
    <div className="notification-list [display:flex] [flex-direction:column] [gap:10px]">
      {items.map((item) => {
        const { text, Icon } = events[item.kind] || {
          text: "updated your activity",
          Icon: Heart,
        };
        return (
          <article
            className={`flex items-center gap-3 rounded-xl border border-matcha-border p-3 ${item.is_read ? "bg-matcha-surface" : "bg-matcha-raised"}`}
            key={item.id}
            data-notification-id={item.id}
            aria-label={`${item.username} ${text}${item.is_read ? ", read" : ", unread"}`}
          >
            <UiButton
              className="flex min-w-0 flex-1 items-center justify-start gap-3 border-0 bg-transparent text-left hover:bg-transparent"
              disabled={busy}
              onClick={() => void run(() => open(item))}
            >
              <span
                className="event-icon [display:grid] [place-items:center] [flex:none] [width:50px] [height:50px] [border-radius:13px] [background:var(--accent-soft)] [color:var(--accent-soft-foreground)] [font-size:28px] [display:flex] [flex-shrink:0] [color:var(--accent)]"
                aria-hidden="true"
              >
                <Icon size={20} />
              </span>
              {item.photo_id && (
                <img
                  className="avatar [width:48px] [height:48px] [border-radius:50%] [object-fit:cover]"
                  src={`/api/v1/photos/${item.photo_id}`}
                  alt=""
                />
              )}
              <span className="notification-copy [font-size:14px] [line-height:1.6] [overflow-wrap:anywhere] [min-width:0] [&_small]:[display:block] [&_small]:[font-size:11px] [&_small]:[margin:4px_0_0] [&_small]:[color:var(--muted)] max-[650px]:[font-size:12px]">
                <strong>{item.first_name || item.username}</strong> {text}
                <small>
                  @{item.username} ·{" "}
                  <time dateTime={item.created_at}>
                    {new Date(item.created_at).toLocaleString()}
                  </time>
                </small>
              </span>
            </UiButton>
            {!item.is_read && (
              <UiButton
                className="shrink-0"
                disabled={busy}
                aria-label={`Mark notification from ${item.username} as read`}
                onClick={() => void run(() => markRead(item))}
              >
                Mark read
              </UiButton>
            )}
          </article>
        );
      })}
    </div>
  );
}
