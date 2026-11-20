import type { Notification } from "../../shared/types.ts";

export function notificationAction(item: Pick<Notification, "actor" | "kind">) {
  switch (item.kind) {
    case "message":
      return {
        href: `/messages?conversation=${item.actor}`,
        label: "Open conversation",
      };
    case "date_invite":
    case "date_response":
      return {
        href: `/profile/${item.actor}#date-plans`,
        label: "View date plan",
      };
    case "visit":
    case "like":
    case "match":
    case "disconnect":
      return { href: `/profile/${item.actor}`, label: "View profile" };
    default:
      return { href: "/activity?tab=notifications", label: "View activity" };
  }
}
