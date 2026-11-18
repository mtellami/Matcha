export type ConnectionState = "connecting" | "connected" | "reconnecting";
type Listener = (...args: unknown[]) => void;
export interface LiveSocket {
  connected: boolean;
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
  connect(): unknown;
  disconnect(): unknown;
  timeout(milliseconds: number): {
    emit(
      event: string,
      callback: (
        error: Error | null,
        reply?: { authenticated?: boolean },
      ) => void,
    ): unknown;
  };
}

// Events are refresh hints. Private data is always fetched through authenticated REST.
export function startRealtime(
  socket: LiveSocket,
  refresh: () => void,
  expired: () => void,
  state: (value: ConnectionState) => void,
) {
  let active = true;
  let updateTimer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (!active) return;
    active = false;
    clearInterval(timer);
    if (updateTimer !== null) clearTimeout(updateTimer);
    for (const [event, listener] of listeners) socket.off(event, listener);
    socket.disconnect();
  };
  const invalidate = () => {
    if (!active) return;
    stop();
    expired();
  };
  const heartbeat = () => {
    if (!active || !socket.connected) return;
    socket.timeout(4000).emit("heartbeat", (error, reply) => {
      if (active && !error && reply?.authenticated === false) invalidate();
    });
  };
  const connected = () => {
    if (active) {
      state("connected");
      refresh();
      heartbeat();
    }
  };
  const changed = () => {
    if (!active || updateTimer !== null) return;
    updateTimer = setTimeout(() => {
      updateTimer = null;
      if (active) refresh();
    }, 100);
  };
  const disconnected = () => {
    if (active) state("reconnecting");
  };
  const listeners: [string, Listener][] = [
    ["connect", connected],
    ["notification", changed],
    ["presence:changed", changed],
    ["session_expired", invalidate],
    ["disconnect", disconnected],
    ["connect_error", disconnected],
  ];
  listeners.forEach(([event, listener]) => socket.on(event, listener));
  const timer = setInterval(heartbeat, 5000);
  state("connecting");
  socket.connect();
  return stop;
}
