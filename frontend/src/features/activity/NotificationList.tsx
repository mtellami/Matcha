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
    <div className="notification-list">
      {items.map((item) => {
        const { text, Icon } = events[item.kind] || {
          text: "updated your activity",
          Icon: Heart,
        };
        return (
          <article
            className={
              item.is_read ? "notification-row" : "notification-row unread"
            }
            key={item.id}
            data-notification-id={item.id}
            aria-label={`${item.username} ${text}${item.is_read ? ", read" : ", unread"}`}
          >
            <button
              className="notification-open"
              disabled={busy}
              onClick={() => void run(() => open(item))}
            >
              <span className="event-icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              {item.photo_id && (
                <img
                  className="avatar"
                  src={`/api/v1/photos/${item.photo_id}`}
                  alt=""
                />
              )}
              <span className="notification-copy">
                <strong>{item.first_name || item.username}</strong> {text}
                <small>
                  @{item.username} ·{" "}
                  <time dateTime={item.created_at}>
                    {new Date(item.created_at).toLocaleString()}
                  </time>
                </small>
              </span>
            </button>
            {!item.is_read && (
              <button
                className="mark-read"
                disabled={busy}
                aria-label={`Mark notification from ${item.username} as read`}
                onClick={() => void run(() => markRead(item))}
              >
                Mark read
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
