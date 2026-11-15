export type HistoryPage<T> = { items: T[]; next_before: number | null };

// Refresh through the oldest row the user loaded, even after a burst of new events.
export async function historyWindow<T extends { id: number }>(
  load: (before: number | null) => Promise<HistoryPage<T>>,
  oldest: number | null,
): Promise<HistoryPage<T>> {
  let before: number | null = null;
  const items: T[] = [];
  while (true) {
    const page = await load(before);
    items.push(...page.items);
    const next = page.next_before;
    if (next === null || oldest === null || next <= oldest)
      return { items, next_before: next };
    if (!page.items.length || (before !== null && next >= before))
      throw new Error("Activity history returned an invalid cursor. Please refresh.");
    before = next;
  }
}
