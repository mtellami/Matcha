import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startRealtime,
  type LiveSocket,
  type ConnectionState,
} from "../src/features/realtime/realtime.ts";

type Listener = (...args: unknown[]) => void;
class FakeSocket implements LiveSocket {
  connected = false;
  connects = 0;
  disconnects = 0;
  beats = 0;
  reply: { authenticated?: boolean } | undefined = { authenticated: true };
  listeners = new Map<string, Set<Listener>>();
  pending:
    | ((error: Error | null, reply?: { authenticated?: boolean }) => void)
    | null = null;
  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }
  connect() {
    this.connects++;
  }
  disconnect() {
    this.disconnects++;
    this.connected = false;
    this.fire("disconnect");
  }
  fire(event: string, ...args: unknown[]) {
    if (event === "connect") this.connected = true;
    if (event === "disconnect") this.connected = false;
    this.listeners.get(event)?.forEach((listener) => listener(...args));
  }
  timeout(milliseconds: number) {
    assert.equal(milliseconds, 4000);
    return {
      emit: (
        event: string,
        callback: (
          error: Error | null,
          reply?: { authenticated?: boolean },
        ) => void,
      ) => {
        assert.equal(event, "heartbeat");
        this.beats++;
        this.pending = callback;
        if (this.reply) callback(null, this.reply);
      },
    };
  }
}

test("connect and reconnect request persisted state; duplicate hints are coalesced", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const socket = new FakeSocket();
  const states: ConnectionState[] = [];
  let refreshes = 0;
  const stop = startRealtime(
    socket,
    () => refreshes++,
    () => assert.fail("session still valid"),
    (state) => states.push(state),
  );
  try {
    assert.equal(socket.connects, 1);
    socket.fire("connect");
    assert.equal(refreshes, 1);
    assert.equal(socket.beats, 1);
    socket.fire("notification", { id: 1 });
    socket.fire("notification", { id: 1 });
    t.mock.timers.tick(100);
    assert.equal(refreshes, 2);
    socket.fire("disconnect");
    socket.fire("connect");
    assert.equal(refreshes, 3);
    assert.deepEqual(states, [
      "connecting",
      "connected",
      "reconnecting",
      "connected",
    ]);
  } finally {
    stop();
  }
});
test("a revoked session heartbeat closes the connection and expires the UI once", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const socket = new FakeSocket();
  let expired = 0;
  const stop = startRealtime(
    socket,
    () => {},
    () => expired++,
    () => {},
  );
  socket.fire("connect");
  socket.reply = { authenticated: false };
  t.mock.timers.tick(5000);
  assert.equal(expired, 1);
  assert.equal(socket.disconnects, 1);
  assert.equal(socket.connected, false);
  t.mock.timers.tick(15000);
  assert.equal(expired, 1);
  stop();
});
test("server session-expiry signals close a connected browser immediately", () => {
  const socket = new FakeSocket();
  let expired = 0;
  const stop = startRealtime(
    socket,
    () => {},
    () => expired++,
    () => {},
  );
  socket.fire("connect");
  socket.fire("session_expired");
  socket.fire("session_expired");
  assert.equal(expired, 1);
  assert.equal(socket.disconnects, 1);
  stop();
});
test("unmount clears pending hints and ignores late authentication replies", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const socket = new FakeSocket();
  socket.reply = undefined;
  let refreshes = 0,
    expired = 0;
  const stop = startRealtime(
    socket,
    () => refreshes++,
    () => expired++,
    () => {},
  );
  socket.fire("connect");
  socket.fire("notification");
  const late = socket.pending;
  stop();
  t.mock.timers.tick(10000);
  late?.(null, { authenticated: false });
  socket.fire("connect");
  assert.equal(refreshes, 1);
  assert.equal(expired, 0);
  assert.equal(socket.beats, 1);
  assert.equal(
    [...socket.listeners.values()].reduce((n, list) => n + list.size, 0),
    0,
  );
});
test("transport or acknowledgement failures allow polling fallback without logging out", () => {
  const socket = new FakeSocket();
  socket.reply = undefined;
  let expired = 0;
  const states: ConnectionState[] = [];
  const stop = startRealtime(
    socket,
    () => {},
    () => expired++,
    (state) => states.push(state),
  );
  try {
    socket.fire("connect_error");
    socket.fire("connect");
    socket.pending?.(new Error("timeout"));
    assert.equal(expired, 0);
    assert.deepEqual(states, ["connecting", "reconnecting", "connected"]);
  } finally {
    stop();
  }
});
