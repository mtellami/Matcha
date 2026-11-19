import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { api } from "../../shared/api";
import type { Notification } from "../../shared/types";

const descriptions: Record<string, string> = {
  visit: "viewed your profile",
  like: "liked your profile",
  match: "connected with you",
  message: "sent you a message",
  disconnect: "removed their interest",
  date_invite: "invited you to plan a date",
  date_response: "responded to a date plan",
};

export function useActivityToast(socket: Socket | null) {
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    setToast(null);
    if (!socket) return;
    const controller = new AbortController();
    const seen = new Set<number>();
    let latest = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function receive(event: { id?: unknown } | null) {
      if (!event || !Number.isSafeInteger(event.id)) return;
      const id = event.id as number;
      if (seen.has(id)) return;
      seen.add(id);
      if (seen.size > 200) seen.delete(seen.values().next().value!);
      latest = id;
      try {
        // Socket events are hints; fetch authorized activity before displaying it.
        const { notifications } = await api<{ notifications: Notification[] }>(
          "/notifications",
          "GET",
          undefined,
          controller.signal,
          5000,
        );
        const item = notifications.find(
          (notification) => notification.id === id,
        );
        if (controller.signal.aborted || latest !== id || !item) return;
        const name =
          [item.first_name, item.last_name].filter(Boolean).join(" ") ||
          item.username;
        setToast({
          id,
          text: `${name} ${descriptions[item.kind] || "updated your activity"}`,
        });
        clearTimeout(timer);
        timer = setTimeout(() => setToast(null), 3000);
      } catch {
        // Activity remains available in the drawer if the toast cannot load.
      }
    }
    socket.on("notification", receive);
    return () => {
      controller.abort();
      clearTimeout(timer);
      socket.off("notification", receive);
    };
  }, [socket]);
  return { toast, dismissToast: () => setToast(null) };
}
