import { api } from "./api.ts";
import type { Message } from "./types";

export type MessagePage = {
  messages: Message[];
  next_before: number | null;
  next_after?: number | null;
};
type ReadPage = (path: string, signal?: AbortSignal) => Promise<MessagePage>;
const readPage: ReadPage = (path, signal) =>
  api<MessagePage>(path, "GET", undefined, signal);

export function mergeMessages(
  existing: Message[],
  incoming: Message[],
): Message[] {
  const merged = new Map(existing.map((message) => [message.id, message]));
  incoming.forEach((message) => merged.set(message.id, message));
  return [...merged.values()].sort((a, b) => a.id - b.id);
}

export async function messageUpdates(
  peer: number,
  after: number | null,
  signal?: AbortSignal,
  read: ReadPage = readPage,
) {
  let cursor = after;
  const messages: Message[] = [];
  let nextBefore: number | null = null;
  while (true) {
    const path =
      `/conversations/${peer}/messages` +
      (cursor === null ? "" : `?after=${cursor}`);
    const page = await read(path, signal);
    messages.push(...page.messages);
    if (after === null) {
      nextBefore = page.next_before;
      break;
    }
    if (page.next_after === null || page.next_after === undefined) break;
    if (
      !page.messages.length ||
      page.next_after <= (cursor ?? 0) ||
      page.next_after !== page.messages.at(-1)?.id
    ) {
      throw new Error(
        "Message history returned an invalid cursor. Please try again.",
      );
    }
    cursor = page.next_after;
  }
  return {
    messages,
    next_before: nextBefore,
    latest: messages.at(-1)?.id ?? after ?? 0,
  };
}
