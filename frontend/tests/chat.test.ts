import { test } from "node:test";
import assert from "node:assert/strict";
import {
  messageUpdates,
  mergeMessages,
  type MessagePage,
} from "../src/features/chat/chat.ts";
import type { Message } from "../src/shared/types.ts";

const message = (id: number): Message => ({
  id,
  actor: 1,
  target: 2,
  body: "message " + id,
  created_at: "2026-01-01T12:00:00Z",
  is_read: false,
});
test("initial history keeps the older-page cursor", async () => {
  const result = await messageUpdates(2, null, undefined, async (path) => {
    assert.equal(path, "/conversations/2/messages");
    return { messages: [message(80), message(81)], next_before: 80 };
  });
  assert.equal(result.latest, 81);
  assert.equal(result.next_before, 80);
});
test("reconnection drains every page instead of losing a burst larger than fifty messages", async () => {
  const calls: string[] = [];
  const pages: MessagePage[] = [
    {
      messages: Array.from({ length: 50 }, (_, i) => message(11 + i)),
      next_before: null,
      next_after: 60,
    },
    {
      messages: Array.from({ length: 50 }, (_, i) => message(61 + i)),
      next_before: null,
      next_after: 110,
    },
    {
      messages: Array.from({ length: 20 }, (_, i) => message(111 + i)),
      next_before: null,
      next_after: null,
    },
  ];
  const result = await messageUpdates(2, 10, undefined, async (path) => {
    calls.push(path);
    return pages.shift()!;
  });
  assert.deepEqual(calls, [
    "/conversations/2/messages?after=10",
    "/conversations/2/messages?after=60",
    "/conversations/2/messages?after=110",
  ]);
  assert.equal(result.messages.length, 120);
  assert.equal(new Set(result.messages.map((m) => m.id)).size, 120);
  assert.equal(result.latest, 130);
});
test("an empty conversation starts catching up from zero", async () => {
  const empty = await messageUpdates(2, null, undefined, async () => ({
    messages: [],
    next_before: null,
  }));
  assert.equal(empty.latest, 0);
  const response = await messageUpdates(
    2,
    empty.latest,
    undefined,
    async (path) => {
      assert.equal(path, "/conversations/2/messages?after=0");
      return { messages: [message(3)], next_before: null, next_after: null };
    },
  );
  assert.equal(response.latest, 3);
});
test("overlapping send/history responses merge without duplicate message rows", () => {
  const updated = { ...message(2), is_read: true };
  const result = mergeMessages(
    [message(2), message(4)],
    [message(1), updated, message(4)],
  );
  assert.deepEqual(
    result.map((m) => m.id),
    [1, 2, 4],
  );
  assert.equal(result[1].is_read, true);
});
test("broken cursors cannot make reconnect recovery loop forever", async () => {
  for (const page of [
    { messages: [], next_before: null, next_after: 50 },
    { messages: [message(20)], next_before: null, next_after: 10 },
    { messages: [message(20)], next_before: null, next_after: 30 },
  ]) {
    await assert.rejects(
      messageUpdates(2, 10, undefined, async () => page),
      /invalid cursor/,
    );
  }
});
test("cancelling a conversation stops recovery requests", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    messageUpdates(2, 10, controller.signal, async (_, signal) => {
      signal?.throwIfAborted();
      return { messages: [], next_before: null };
    }),
    { name: "AbortError" },
  );
});

test("message polling reports a disconnect even when there are no new messages", async () => {
  const result = await messageUpdates(2, 12, undefined, async () => ({
    connected: false,
    messages: [],
    next_before: null,
    next_after: null,
  }));
  assert.equal(result.connected, false);
  assert.equal(result.latest, 12);
  assert.deepEqual(result.messages, []);
});
