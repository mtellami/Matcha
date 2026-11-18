import { UiButton } from "../../shared/UiButton";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, MessageCircle, Send } from "lucide-react";
import { useSearchParams } from "react-router";
import { api } from "../../shared/api";
import type { Conversation, Message, Runner } from "../../shared/types";
import { messageUpdates, mergeMessages } from "../chat/chat";

function fullName(person: Pick<Conversation, "first_name" | "last_name">) {
  return [person.first_name, person.last_name].filter(Boolean).join(" ");
}

export function Inbox({
  revision,
  run,
  changed,
}: {
  revision: number;
  run: Runner;
  changed: () => Promise<void>;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = Number(searchParams.get("conversation")) || null;
  const [items, setItems] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await api<{ conversations: Conversation[] }>(
          "/conversations",
        );
        if (active) {
          setItems(response.conversations);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [revision, refresh]);

  const markRead = useCallback(
    async (peer: number, throughId: number) => {
      await api(
        `/conversations/${peer}/read`,
        "POST",
        { through_id: throughId },
        undefined,
        4000,
      );
      await changed();
    },
    [changed],
  );

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setNextBefore(null);
      setDraft("");
      return;
    }
    const peerId = selectedId;
    let active = true;
    let inFlight = false;
    let cursor: number | null = null;
    const controller = new AbortController();
    setMessages([]);
    setNextBefore(null);
    setDraft("");
    setThreadLoading(true);
    setError("");

    async function poll(initial = false) {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await messageUpdates(
          peerId,
          initial ? null : cursor,
          controller.signal,
        );
        if (!active) return;
        setMessages((current) => mergeMessages(current, response.messages));
        cursor = response.latest;
        if (initial) setNextBefore(response.next_before);
        const latestId = response.messages.at(-1)?.id;
        if (latestId) await markRead(peerId, latestId);
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        inFlight = false;
        if (active && initial) setThreadLoading(false);
      }
    }
    void poll(true);
    const timer = window.setInterval(() => void poll(), 4000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [selectedId, markRead]);

  async function send() {
    const body = draft.trim();
    if (!selectedId || !body || sending) return;
    const clientId = crypto.randomUUID();
    setSending(true);
    try {
      await api(
        `/conversations/${selectedId}/messages`,
        "POST",
        { body, client_id: clientId },
        undefined,
        8000,
      );
      setDraft("");
      const response = await messageUpdates(
        selectedId,
        messages.at(-1)?.id ?? null,
      );
      setMessages((current) => mergeMessages(current, response.messages));
      await changed();
    } finally {
      setSending(false);
    }
  }

  async function loadOlder() {
    if (!selectedId || !nextBefore) return;
    const response = await api<{
      messages: Message[];
      next_before: number | null;
    }>(`/conversations/${selectedId}/messages?before=${nextBefore}`);
    setMessages((current) => mergeMessages(current, response.messages));
    setNextBefore(response.next_before);
  }

  function selectConversation(id: number) {
    setSearchParams({ conversation: String(id) });
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <p className="sr-only" role="status" aria-live="polite">
        {loading
          ? "Loading conversations."
          : error
            ? "Messages could not be refreshed."
            : `${items.length} conversations loaded.`}
      </p>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger-text)]"
        >
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-3xl border border-matcha-border bg-matcha-surface shadow-[0_18px_50px_var(--shadow)] md:grid-cols-[minmax(250px,0.36fr)_minmax(0,0.64fr)]">
        <aside
          className={`${selectedId ? "hidden md:flex" : "flex"} min-w-0 flex-col border-matcha-border md:border-r`}
          aria-label="Conversations"
        >
          <div className="flex items-center justify-between gap-3 border-b border-matcha-border px-5 py-4">
            <h2 className="m-0 text-lg font-semibold">Messages</h2>
            <UiButton
              className="min-h-9 rounded-full px-3 text-xs"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setRefresh((value) => value + 1);
              }}
            >
              {loading ? "Loading…" : "Refresh"}
            </UiButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => selectConversation(item.id)}
                aria-current={selectedId === item.id ? "true" : undefined}
                aria-label={`${fullName(item)}${item.online ? ", online" : ", offline"}${item.unread > 0 ? `, ${item.unread} unread messages` : ""}`}
                className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-matcha-accent ${selectedId === item.id ? "bg-matcha-accent/10" : "bg-transparent"}`}
              >
                {item.photo_id ? (
                  <img
                    className="size-12 shrink-0 rounded-full object-cover"
                    src={`/api/v1/photos/${item.photo_id}`}
                    alt=""
                  />
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-matcha-raised text-matcha-accent">
                    <MessageCircle size={21} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <strong className="truncate text-sm font-semibold text-matcha-text">
                      {fullName(item)}
                    </strong>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={`size-2 rounded-full ${item.online ? "bg-emerald-500" : "bg-matcha-muted/50"}`}
                        aria-label={item.online ? "Online" : "Offline"}
                      />
                      {item.unread > 0 && (
                        <span className="rounded-full bg-matcha-accent px-2 py-0.5 text-[10px] font-bold text-matcha-bg">
                          {item.unread}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-matcha-muted">
                    {item.preview || "You connected. Say hello!"}
                  </span>
                </span>
              </button>
            ))}
            {!loading && !items.length && (
              <div className="px-4 py-10 text-center text-sm text-matcha-muted">
                <MessageCircle className="mx-auto mb-3" size={30} />
                <p className="m-0">
                  When you connect with someone, your conversation will appear
                  here.
                </p>
              </div>
            )}
          </div>
        </aside>

        <div
          className={`${selectedId ? "flex" : "hidden md:flex"} min-w-0 flex-col`}
        >
          {selected ? (
            <>
              <header className="flex min-h-[74px] items-center gap-3 border-b border-matcha-border px-4 py-3 sm:px-6">
                <UiButton
                  className="min-h-10 rounded-full px-3 md:hidden"
                  aria-label="Back to conversations"
                  onClick={() => setSearchParams({})}
                >
                  <ArrowLeft size={18} />
                </UiButton>
                {selected.photo_id ? (
                  <img
                    className="size-10 rounded-full object-cover"
                    src={`/api/v1/photos/${selected.photo_id}`}
                    alt=""
                  />
                ) : (
                  <span className="grid size-10 place-items-center rounded-full bg-matcha-raised text-matcha-accent">
                    <MessageCircle size={18} />
                  </span>
                )}
                <div className="min-w-0">
                  <h2 className="m-0 truncate text-base font-semibold">
                    {fullName(selected)}
                  </h2>
                  <p className="m-0 flex items-center gap-1.5 text-xs text-matcha-muted">
                    <span
                      className={`size-2 rounded-full ${selected.online ? "bg-emerald-500" : "bg-matcha-muted/60"}`}
                    />
                    {selected.online ? "Online now" : "Offline"}
                  </p>
                </div>
              </header>
              <div
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6"
                role="log"
                aria-label={`Conversation with ${selected.first_name}`}
                aria-live="polite"
                aria-relevant="additions text"
              >
                {nextBefore && (
                  <UiButton
                    className="mx-auto min-h-9 rounded-full px-4 text-xs"
                    disabled={threadLoading}
                    onClick={() => void run(loadOlder)}
                  >
                    Load older messages
                  </UiButton>
                )}
                {threadLoading && !messages.length && (
                  <p className="m-auto text-sm text-matcha-muted" role="status">
                    Loading messages…
                  </p>
                )}
                {!threadLoading && !messages.length && (
                  <p className="m-auto max-w-xs text-center text-sm text-matcha-muted">
                    You’re connected. Send a hello to get the conversation
                    started.
                  </p>
                )}
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 ${message.actor === selected.id ? "self-start rounded-bl-md bg-matcha-raised text-matcha-text" : "self-end rounded-br-md bg-matcha-accent text-[var(--accent-foreground)]"}`}
                  >
                    <p
                      className={`m-0 text-sm leading-relaxed ${message.actor === selected.id ? "text-matcha-text" : "text-[var(--accent-foreground)]"}`}
                    >
                      {message.body}
                    </p>
                    <time
                      className="mt-1 block text-right text-[10px] opacity-70"
                      dateTime={message.created_at}
                    >
                      {new Date(message.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </article>
                ))}
              </div>
              <form
                className="border-t border-matcha-border p-3 sm:p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(send);
                }}
              >
                <div className="flex min-h-14 items-center gap-2 rounded-full border border-matcha-border bg-matcha-bg py-1 pl-5 pr-1.5 transition-shadow focus-within:ring-2 focus-within:ring-matcha-accent">
                  <input
                    aria-label="Message"
                    placeholder={`Message ${fullName(selected)}…`}
                    maxLength={4000}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={sending}
                    className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm font-normal text-matcha-text outline-none placeholder:text-matcha-muted/70"
                  />
                  <UiButton
                    type="submit"
                    variant="primary"
                    aria-label="Send message"
                    disabled={sending || !draft.trim()}
                    className="!size-11 !min-h-11 !min-w-11 shrink-0 !rounded-full !border-matcha-accent !bg-matcha-accent !p-0 !text-[var(--accent-foreground)] hover:!bg-matcha-accent/90"
                  >
                    <Send size={17} />
                  </UiButton>
                </div>
              </form>
            </>
          ) : selectedId ? (
            <div className="grid flex-1 place-items-center p-8 text-center text-sm text-matcha-muted">
              This conversation is not available. Choose a connected person from
              the list.
            </div>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center text-matcha-muted">
              <div>
                <MessageCircle
                  className="mx-auto mb-4 text-matcha-accent"
                  size={38}
                />
                <h2 className="m-0 text-lg font-semibold text-matcha-text">
                  Choose a conversation
                </h2>
                <p className="mb-0 mt-2 text-sm">
                  Your messages with each connection will show here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
