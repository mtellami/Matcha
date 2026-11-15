import { test } from "node:test";
import assert from "node:assert/strict";
import { historyWindow } from "../src/features/activity/history.ts";

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: count - i }));
function history(items: { id: number }[], calls: (number | null)[]) {
  return async (before: number | null) => {
    calls.push(before);
    const remaining = items.filter((item) => before === null || item.id < before);
    const page = remaining.slice(0, 50);
    return { items: page, next_before: remaining.length > 50 ? page.at(-1)!.id : null };
  };
}
test("initial activity fetch stays bounded to one page", async () => {
  const calls: (number | null)[] = [];
  const result = await historyWindow(history(rows(180), calls), null);
  assert.equal(result.items.length, 50);
  assert.deepEqual(calls, [null]);
});
test("a burst of new events preserves the older history a member already loaded", async () => {
  const calls: (number | null)[] = [];
  const result = await historyWindow(history(rows(180), calls), 10);
  assert.equal(result.items.length, 180);
  assert.deepEqual(calls, [null, 131, 81, 31]);
  assert.equal(new Set(result.items.map((item) => item.id)).size, 180);
});
test("filtering or blocking previously loaded rows removes stale history", async () => {
  const calls: (number | null)[] = [];
  const result = await historyWindow(history(rows(120).filter((item) => item.id % 2 === 0), calls), 10);
  assert.equal(result.items.length, 60);
  assert.ok(result.items.every((item) => item.id % 2 === 0));
});
test("a stalled activity cursor cannot keep a refresh running forever", async () => {
  await assert.rejects(historyWindow(async () => ({ items: [{ id: 100 }], next_before: 100 }), 1), /invalid cursor/);
});
