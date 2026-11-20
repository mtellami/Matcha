import { UiButton } from "../../shared/UiButton";
import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Dropdown, Modal, Popover } from "@heroui/react";
import {
  Paperclip,
  LockKeyhole,
  ArrowLeft,
  Ban,
  CheckCheck,
  Flag,
  Camera,
  FileText,
  ImagePlus,
  Link2,
  Mic,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Video,
  ExternalLink,
  Send,
  Pause,
  Play,
  Smile,
  Search,
  User,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router";
import type { Socket } from "socket.io-client";
import { api } from "../../shared/api";
import { useTheme } from "../../shared/theme";
import type { Conversation, Message, Runner } from "../../shared/types";
import { messageUpdates, mergeMessages } from "../chat/chat";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

function fullName(person: Pick<Conversation, "first_name" | "last_name">) {
  return [person.first_name, person.last_name].filter(Boolean).join(" ");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentDisplay(name: string, contentType: string) {
  const extensionStart = name.lastIndexOf(".");
  const hasExtension = extensionStart > 0 && extensionStart < name.length - 1;
  const subtype = contentType.split("/")[1]?.split(";")[0];
  return {
    name: hasExtension ? name.slice(0, extensionStart) : name,
    type: hasExtension
      ? name.slice(extensionStart + 1).toUpperCase()
      : subtype && subtype !== "octet-stream"
        ? subtype.toUpperCase()
        : "FILE",
  };
}

type MessagePart =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

function messageParts(body: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let cursor = 0;
  for (const match of body.matchAll(pattern)) {
    const raw = match[0];
    let urlEnd = raw.length;
    while (urlEnd > 0 && /[.,!?;:)]/.test(raw[urlEnd - 1])) urlEnd -= 1;
    const candidate = raw.slice(0, urlEnd);
    let href: string | null = null;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        href = parsed.href;
      }
    } catch {
      // Keep malformed URLs as plain message text.
    }
    const start = match.index ?? cursor;
    if (start > cursor)
      parts.push({ type: "text", value: body.slice(cursor, start) });
    if (href) parts.push({ type: "link", value: candidate, href });
    else parts.push({ type: "text", value: candidate });
    if (urlEnd < raw.length) {
      parts.push({ type: "text", value: raw.slice(urlEnd) });
    }
    cursor = start + raw.length;
  }
  if (cursor < body.length)
    parts.push({ type: "text", value: body.slice(cursor) });
  return parts;
}

function linkPreviewDetails(href: string) {
  const url = new URL(href);
  return {
    host: url.hostname.replace(/^www\./i, ""),
    address: href.replace(/^https?:\/\//i, ""),
  };
}

function conversationDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay)
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) /
      86400000,
  );
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function messageDay(value: string) {
  const date = new Date(value);
  const now = new Date();
  const day = (item: Date) =>
    new Date(item.getFullYear(), item.getMonth(), item.getDate()).getTime();
  const difference = Math.round((day(now) - day(date)) / 86400000);
  if (difference === 0) return "Today";
  if (difference === 1) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatAudioTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function VoiceMessagePlayer({ src, own }: { src: string; own: boolean }) {
  const barCount = 32;
  const audio = useRef<HTMLAudioElement>(null);
  const waveform = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformHeights, setWaveformHeights] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let audioContext: AudioContext | null = null;

    async function decodeWaveform() {
      setWaveformHeights(null);
      try {
        const response = await fetch(src, { credentials: "same-origin" });
        if (!response.ok) throw new Error("Could not load voice message");
        const audioData = await response.arrayBuffer();
        audioContext = new AudioContext();
        const decoded = await audioContext.decodeAudioData(audioData);
        const channels = Array.from(
          { length: decoded.numberOfChannels },
          (_, channel) => decoded.getChannelData(channel),
        );
        const energies = Array.from({ length: barCount }, (_, index) => {
          const start = Math.floor((index * decoded.length) / barCount);
          const end = Math.max(
            start + 1,
            Math.floor(((index + 1) * decoded.length) / barCount),
          );
          let sumSquares = 0;
          let samples = 0;
          for (const channel of channels) {
            for (let sample = start; sample < end; sample += 1) {
              sumSquares += channel[sample] * channel[sample];
              samples += 1;
            }
          }
          return Math.sqrt(sumSquares / Math.max(1, samples));
        });
        const maxEnergy = Math.max(...energies, 0);
        const heights = energies.map((energy) => {
          const normalized = maxEnergy ? energy / maxEnergy : 0;
          return normalized < 0.04 ? 3 : Math.round(12 + normalized * 88);
        });
        if (!cancelled) setWaveformHeights(heights);
      } catch {
        if (!cancelled) setWaveformHeights(Array(barCount).fill(3));
      } finally {
        if (audioContext && audioContext.state !== "closed") {
          await audioContext.close().catch(() => {});
        }
      }
    }

    void decodeWaveform();
    return () => {
      cancelled = true;
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close().catch(() => {});
      }
    };
  }, [src]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const updateProgress = () => {
      const player = audio.current;
      if (!player) return;
      setTime(player.currentTime);
      frame = window.requestAnimationFrame(updateProgress);
    };
    frame = window.requestAnimationFrame(updateProgress);
    return () => window.cancelAnimationFrame(frame);
  }, [playing]);

  async function togglePlayback() {
    const player = audio.current;
    if (!player) return;
    if (player.paused) {
      try {
        await player.play();
      } catch {
        setPlaying(false);
      }
    } else {
      player.pause();
    }
  }

  function seekTo(nextTime: number) {
    const next = Math.max(0, Math.min(duration, nextTime));
    if (audio.current) audio.current.currentTime = next;
    setTime(next);
  }

  function seekFromPointer(clientX: number) {
    const bounds = waveform.current?.getBoundingClientRect();
    if (!bounds || !duration) return;
    const fraction = Math.max(
      0,
      Math.min(1, (clientX - bounds.left) / bounds.width),
    );
    seekTo(fraction * duration);
  }

  const progress = duration ? Math.min(1, time / duration) : 0;

  return (
    <div
      className={`mb-1 flex w-[min(19rem,70vw)] min-w-0 flex-col gap-0.5 rounded-xl px-2.5 py-2 ${own ? "bg-black/10" : "bg-matcha-bg"}`}
    >
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) =>
          setDuration(event.currentTarget.duration || 0)
        }
        onDurationChange={(event) =>
          setDuration(event.currentTarget.duration || 0)
        }
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
      />
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => void togglePlayback()}
          aria-label={playing ? "Pause voice message" : "Play voice message"}
          className={`grid size-9 shrink-0 cursor-pointer place-items-center rounded-full ${own ? "bg-white/15" : "bg-matcha-raised"}`}
        >
          {playing ? (
            <Pause size={16} fill="currentColor" />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
        </button>
        <div
          ref={waveform}
          role="slider"
          tabIndex={0}
          aria-label="Voice message position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatAudioTime(time)} of ${formatAudioTime(duration)}`}
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            seekFromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (dragging.current) seekFromPointer(event.clientX);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") seekTo(time - 1);
            else if (event.key === "ArrowRight") seekTo(time + 1);
            else if (event.key === "Home") seekTo(0);
            else if (event.key === "End") seekTo(duration);
            else return;
            event.preventDefault();
          }}
          className="relative flex h-9 min-w-0 flex-1 touch-none cursor-pointer items-center justify-between gap-[1px] outline-none"
        >
          {(waveformHeights ?? Array(barCount).fill(3)).map((height, index) => {
            const played = progress >= (index + 1) / barCount;
            return (
              <span
                key={index}
                aria-hidden="true"
                style={{ height: `${height}%` }}
                className={`w-[2px] shrink-0 rounded-full transition-colors duration-75 ${played ? (own ? "bg-[var(--accent-foreground)]" : "bg-matcha-accent") : own ? "bg-white/40" : "bg-matcha-muted/40"}`}
              />
            );
          })}
          <span
            aria-hidden="true"
            style={{ left: `${progress * 100}%` }}
            className={`pointer-events-none absolute top-0 h-full w-[2px] -translate-x-1/2 rounded-full shadow-sm ${own ? "bg-[var(--accent-foreground)]" : "bg-matcha-accent"}`}
          />
        </div>
      </div>
      <div className="ml-[46px] flex justify-between text-[10px] tabular-nums opacity-70">
        <span>{formatAudioTime(time)}</span>
        <span>{formatAudioTime(duration)}</span>
      </div>
    </div>
  );
}

function RecordingWaveform({
  seconds,
  paused,
  stream,
}: {
  seconds: number;
  paused: boolean;
  stream: MediaStream | null;
}) {
  const barCount = 28;
  const [levels, setLevels] = useState(() => Array(barCount).fill(0));
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (!stream) return;
    let audioContext: AudioContext;
    try {
      audioContext = new AudioContext();
    } catch {
      return;
    }
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let animationFrame = 0;
    let lastUpdate = 0;
    let wasPaused = false;

    const sampleMicrophone = (time: number) => {
      animationFrame = window.requestAnimationFrame(sampleMicrophone);
      if (time - lastUpdate < 50) return;
      lastUpdate = time;

      if (pausedRef.current) {
        if (!wasPaused) setLevels(Array(barCount).fill(0));
        wasPaused = true;
        return;
      }
      wasPaused = false;

      analyser.getByteTimeDomainData(samples);
      const binSize = Math.floor(samples.length / barCount);
      const nextLevels = Array.from({ length: barCount }, (_, index) => {
        const start = index * binSize;
        let sumSquares = 0;
        for (let sample = start; sample < start + binSize; sample += 1) {
          const amplitude = (samples[sample] - 128) / 128;
          sumSquares += amplitude * amplitude;
        }
        const rms = Math.sqrt(sumSquares / binSize);
        return rms < 0.018 ? 0 : Math.min(1, (rms - 0.018) * 7);
      });
      setLevels(nextLevels);
    };

    void audioContext.resume().catch(() => {});
    animationFrame = window.requestAnimationFrame(sampleMicrophone);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close().catch(() => {});
    };
  }, [stream]);

  return (
    <div
      role="img"
      aria-label={`Voice recording ${formatAudioTime(seconds)}${paused ? ", paused" : ""}`}
      className="flex min-w-0 flex-1 items-center gap-2.5 px-1"
    >
      <span className="shrink-0 text-xs tabular-nums text-matcha-muted">
        {formatAudioTime(seconds)}
      </span>
      <span className="flex h-8 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden">
        {levels.map((level, index) => (
          <span
            key={index}
            aria-hidden="true"
            style={{ height: `${Math.max(1, level * 28)}px` }}
            className={`w-[3px] shrink-0 rounded-full bg-matcha-accent transition-[height] duration-75 ${paused ? "opacity-35" : ""}`}
          />
        ))}
      </span>
      <span className="shrink-0 text-[11px] text-matcha-muted">
        {paused ? "Paused" : "Recording"}
      </span>
    </div>
  );
}

export function Inbox({
  revision,
  run,
  changed,
  openProfile,
  notify,
  socket,
  startCall,
}: {
  revision: number;
  run: Runner;
  changed: () => Promise<void>;
  openProfile: (id: number) => Promise<void>;
  notify: (message: string) => void;
  socket: Socket | null;
  startCall: (
    id: number,
    name: string,
    media: "audio" | "video",
  ) => Promise<void>;
}) {
  const { resolvedTheme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = Number(searchParams.get("conversation")) || null;
  const activeConversationId = useRef(selectedId);
  activeConversationId.current = selectedId;
  const [items, setItems] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const documentInput = useRef<HTMLInputElement>(null);
  const messageLog = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const forceScrollToBottom = useRef(false);
  const previousMessageScroll = useRef<{ height: number; top: number } | null>(
    null,
  );
  const localTypingTimer = useRef<number | null>(null);
  const peerTypingTimer = useRef<number | null>(null);
  const localTypingActive = useRef(false);
  const lastTypingSentAt = useRef(0);
  const cameraVideo = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const voiceStream = useRef<MediaStream | null>(null);
  const voiceRecorder = useRef<MediaRecorder | null>(null);
  const voiceChunks = useRef<Blob[]>([]);
  const cancelVoiceRecording = useRef(false);
  const unreadTotal = items.reduce((sum, item) => sum + item.unread, 0);
  const filteredItems = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return items;
    return items.filter((item) =>
      `${fullName(item)} ${item.username} ${item.preview || ""}`
        .toLocaleLowerCase()
        .includes(search),
    );
  }, [items, query]);
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );
  const canMessage = !!selected && selected.connected !== false;
  const canMessageRef = useRef(canMessage);
  canMessageRef.current = canMessage;

  useLayoutEffect(() => {
    const log = messageLog.current;
    if (!log) return;
    const previous = previousMessageScroll.current;
    if (previous) {
      log.scrollTop = previous.top + (log.scrollHeight - previous.height);
      previousMessageScroll.current = null;
      stickToBottom.current = false;
    } else if (forceScrollToBottom.current || stickToBottom.current) {
      log.scrollTop = log.scrollHeight;
      forceScrollToBottom.current = false;
      stickToBottom.current = true;
    }
  }, [messages, peerTyping, selected]);

  useLayoutEffect(() => {
    const log = messageLog.current;
    if (!log || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current && !previousMessageScroll.current) {
        log.scrollTop = log.scrollHeight;
      }
    });
    observer.observe(log);
    Array.from(log.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [messages.length, peerTyping, selected]);

  useEffect(() => {
    if (!cameraOpen) return;
    let active = true;
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not available in this browser.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStream.current = stream;
        if (cameraVideo.current) cameraVideo.current.srcObject = stream;
      })
      .catch(() => {
        if (active) setCameraError("Allow camera access to take a photo.");
      });
    return () => {
      active = false;
      cameraStream.current?.getTracks().forEach((track) => track.stop());
      cameraStream.current = null;
    };
  }, [cameraOpen]);

  useEffect(() => {
    if (!recording) setRecordingSeconds(0);
    if (!recording || recordingPaused) return;
    const timer = window.setInterval(
      () => setRecordingSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [recording, recordingPaused]);

  useEffect(
    () => () => {
      const recorder = voiceRecorder.current;
      if (recorder) {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      voiceStream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
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
  }, [revision]);

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

  const stopTyping = useCallback(
    (peerId = selectedId) => {
      if (localTypingTimer.current !== null) {
        window.clearTimeout(localTypingTimer.current);
        localTypingTimer.current = null;
      }
      if (localTypingActive.current && socket?.connected && peerId) {
        socket.emit("conversation:typing", {
          peer_id: peerId,
          is_typing: false,
        });
      }
      localTypingActive.current = false;
      lastTypingSentAt.current = 0;
    },
    [selectedId, socket],
  );

  const changeDraft = useCallback(
    (value: string) => {
      if (!canMessageRef.current) return;
      setDraft(value);
      if (!value.trim()) {
        stopTyping();
        return;
      }
      if (!selectedId || !socket?.connected) return;
      const now = Date.now();
      if (!localTypingActive.current || now - lastTypingSentAt.current >= 800) {
        socket.emit("conversation:typing", {
          peer_id: selectedId,
          is_typing: true,
        });
        localTypingActive.current = true;
        lastTypingSentAt.current = now;
      }
      if (localTypingTimer.current !== null)
        window.clearTimeout(localTypingTimer.current);
      localTypingTimer.current = window.setTimeout(
        () => stopTyping(selectedId),
        1800,
      );
    },
    [selectedId, socket, stopTyping],
  );

  useEffect(() => {
    if (!socket || !selectedId || !canMessage) {
      setPeerTyping(false);
      return;
    }
    const onTyping = (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const event = payload as {
        conversation_id?: unknown;
        is_typing?: unknown;
      };
      if (event.conversation_id !== selectedId) return;
      const isTyping = event.is_typing === true;
      setPeerTyping(isTyping);
      if (peerTypingTimer.current !== null) {
        window.clearTimeout(peerTypingTimer.current);
        peerTypingTimer.current = null;
      }
      if (isTyping) {
        peerTypingTimer.current = window.setTimeout(() => {
          setPeerTyping(false);
          peerTypingTimer.current = null;
        }, 2500);
      }
    };
    const onReconnect = () => {
      if (localTypingActive.current) {
        socket.emit("conversation:typing", {
          peer_id: selectedId,
          is_typing: true,
        });
      }
    };
    socket.on("conversation:typing", onTyping);
    socket.on("connect", onReconnect);
    return () => {
      socket.off("conversation:typing", onTyping);
      socket.off("connect", onReconnect);
      stopTyping(selectedId);
      if (peerTypingTimer.current !== null) {
        window.clearTimeout(peerTypingTimer.current);
        peerTypingTimer.current = null;
      }
      setPeerTyping(false);
    };
  }, [selectedId, socket, stopTyping, canMessage]);

  useEffect(() => {
    if (canMessage) return;
    stopTyping();
    setPeerTyping(false);
    setEmojiOpen(false);
    setCameraOpen(false);
    cancelVoice();
  }, [canMessage, stopTyping]);

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
    setLoadingOlder(false);
    forceScrollToBottom.current = true;
    stickToBottom.current = true;
    setError("");

    async function poll(initial = false) {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await messageUpdates(
          peerId,
          initial ? null : cursor,
          controller.signal,
          undefined,
          initial ? 10 : 50,
        );
        if (!active) return;
        setMessages((current) => mergeMessages(current, response.messages));
        if (response.connected !== undefined) {
          setItems((current) =>
            current.map((item) =>
              item.id === peerId && item.connected !== response.connected
                ? { ...item, connected: response.connected! }
                : item,
            ),
          );
        }
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
    if (!selectedId || !canMessageRef.current || !body || sending) return;
    stopTyping(selectedId);
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
      const sentAt = new Date().toISOString();
      setItems((current) => {
        const conversation = current.find((item) => item.id === selectedId);
        if (!conversation) return current;
        return [
          { ...conversation, preview: body, last_message_at: sentAt },
          ...current.filter((item) => item.id !== selectedId),
        ];
      });
      const response = await messageUpdates(
        selectedId,
        messages.at(-1)?.id ?? null,
      );
      forceScrollToBottom.current = true;
      setMessages((current) => mergeMessages(current, response.messages));
      await changed();
    } finally {
      setSending(false);
    }
  }

  async function sendAttachment(
    file: File,
    kind: "photo" | "document" | "voice",
  ) {
    if (!selectedId || !canMessageRef.current || sending) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("Attachments must be 8 MB or smaller.");
      return;
    }
    const body =
      kind === "photo"
        ? "Photo"
        : kind === "voice"
          ? "Voice message"
          : file.name;
    const form = new FormData();
    form.append("attachment", file, file.name);
    form.append("attachment_kind", kind);
    form.append("client_id", crypto.randomUUID());
    form.append("body", body);
    setSending(true);
    setError("");
    try {
      await api(
        `/conversations/${selectedId}/attachments`,
        "POST",
        form,
        undefined,
        30000,
      );
      setItems((current) => {
        const conversation = current.find((item) => item.id === selectedId);
        if (!conversation) return current;
        return [
          {
            ...conversation,
            preview: body,
            last_message_at: new Date().toISOString(),
          },
          ...current.filter((item) => item.id !== selectedId),
        ];
      });
      const response = await messageUpdates(
        selectedId,
        messages.at(-1)?.id ?? null,
      );
      forceScrollToBottom.current = true;
      setMessages((current) => mergeMessages(current, response.messages));
      await changed();
    } finally {
      setSending(false);
    }
  }

  async function capturePhoto() {
    const video = cameraVideo.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setCameraError("The camera is still starting. Try again in a moment.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Could not capture an image from the camera.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) {
      setCameraError("Could not prepare the camera photo.");
      return;
    }
    const photo = new File([blob], `matcha-camera-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    setCameraOpen(false);
    await run(() => sendAttachment(photo, "photo"));
  }

  async function toggleVoiceRecording() {
    if (!canMessageRef.current) return;
    const current = voiceRecorder.current;
    if (current) {
      if (current.state !== "inactive") current.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("Voice messages are not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!canMessageRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      voiceStream.current = stream;
      const supportedMime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);
      voiceChunks.current = [];
      voiceRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) voiceChunks.current.push(event.data);
      };
      recorder.onerror = () =>
        setError("The voice message could not be recorded.");
      recorder.onstop = () => {
        const cancelled = cancelVoiceRecording.current;
        cancelVoiceRecording.current = false;
        let voice: File | null = null;
        if (!cancelled) {
          const mime = recorder.mimeType || "audio/webm";
          const extension = mime.includes("mp4")
            ? "m4a"
            : mime.includes("ogg")
              ? "ogg"
              : mime.includes("wav")
                ? "wav"
                : "webm";
          voice = new File(
            [new Blob(voiceChunks.current, { type: mime })],
            `voice-message-${Date.now()}.${extension}`,
            { type: mime },
          );
        }
        stream.getTracks().forEach((track) => track.stop());
        voiceStream.current = null;
        voiceRecorder.current = null;
        setRecording(false);
        setRecordingPaused(false);
        if (voice?.size) void run(() => sendAttachment(voice, "voice"));
      };
      cancelVoiceRecording.current = false;
      recorder.start();
      setError("");
      setRecording(true);
      setRecordingPaused(false);
    } catch {
      voiceStream.current?.getTracks().forEach((track) => track.stop());
      voiceStream.current = null;
      voiceRecorder.current = null;
      setRecording(false);
      setRecordingPaused(false);
      setError(
        "Could not start recording. Check microphone access and browser support.",
      );
    }
  }

  function toggleVoicePause() {
    const recorder = voiceRecorder.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setRecordingPaused(true);
    } else if (recorder.state === "paused") {
      recorder.resume();
      setRecordingPaused(false);
    }
  }

  function cancelVoice() {
    const recorder = voiceRecorder.current;
    if (!recorder) return;
    cancelVoiceRecording.current = true;
    if (recorder.state !== "inactive") recorder.stop();
  }

  async function loadOlder() {
    if (!selectedId || !nextBefore || loadingOlder) return;
    const peerId = selectedId;
    const before = nextBefore;
    setLoadingOlder(true);
    let loaded = false;
    try {
      const response = await api<{
        messages: Message[];
        next_before: number | null;
      }>(`/conversations/${peerId}/messages?before=${before}&limit=10`);
      if (activeConversationId.current !== peerId) return;
      const log = messageLog.current;
      if (log) {
        previousMessageScroll.current = {
          height: log.scrollHeight,
          top: log.scrollTop,
        };
      }
      setMessages((current) => mergeMessages(current, response.messages));
      setNextBefore(response.next_before);
      loaded = true;
    } finally {
      setLoadingOlder(false);
      if (!loaded) previousMessageScroll.current = null;
    }
  }

  function selectConversation(id: number) {
    if (recording) {
      setError("Stop recording before switching conversations.");
      return;
    }
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

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden border-0 bg-matcha-bg shadow-none min-[841px]:grid-cols-[minmax(250px,0.36fr)_minmax(0,0.64fr)] md:rounded-3xl md:border md:border-matcha-border md:bg-matcha-surface md:shadow-[0_18px_50px_var(--shadow)]">
        <aside
          className={`${selectedId ? "hidden min-[841px]:flex" : "flex"} min-w-0 flex-col border-matcha-border md:border-r`}
          aria-label="Conversations"
        >
          <div className="border-b border-matcha-border px-4 pb-4 pt-5 sm:px-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="m-0 text-xl font-semibold">Messages</h2>
              {unreadTotal > 0 && (
                <span className="shrink-0 rounded-full bg-matcha-accent/10 px-3 py-1 text-xs font-semibold text-matcha-accent">
                  {unreadTotal} new
                </span>
              )}
            </div>
            <label className="flex h-11 items-center gap-2.5 rounded-full border border-matcha-border bg-matcha-bg px-4 text-matcha-muted focus-within:ring-2 focus-within:ring-matcha-accent">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-matcha-text outline-none placeholder:text-matcha-muted/70"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filteredItems.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => selectConversation(item.id)}
                aria-current={selectedId === item.id ? "true" : undefined}
                aria-label={`${fullName(item)}${item.online ? ", online" : ", offline"}${item.unread > 0 ? `, ${item.unread} unread messages` : ""}`}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-matcha-accent ${selectedId === item.id ? "bg-matcha-accent/10" : "bg-transparent"}`}
              >
                <span className="relative size-12 shrink-0">
                  {item.photo_id ? (
                    <img
                      className="size-full rounded-full object-cover"
                      src={`/api/v1/photos/${item.photo_id}`}
                      alt=""
                    />
                  ) : (
                    <span className="grid size-full place-items-center rounded-full bg-matcha-raised text-matcha-accent">
                      <User size={21} />
                    </span>
                  )}
                  <span
                    className={`absolute bottom-0 right-0 size-3 rounded-full border-2 border-matcha-surface ${item.online ? "bg-emerald-500" : "bg-matcha-muted/50"}`}
                    aria-label={item.online ? "Online" : "Offline"}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <strong className="truncate text-sm font-semibold text-matcha-text">
                      {fullName(item)}
                    </strong>
                    <span className="flex shrink-0 items-center gap-2">
                      <time className="text-[11px] text-matcha-muted">
                        {conversationDate(item.last_message_at)}
                      </time>
                      {item.unread > 0 && (
                        <span className="grid size-5 place-items-center rounded-full bg-matcha-accent text-[10px] font-bold text-white">
                          {item.unread}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-matcha-muted">
                    {item.preview ||
                      (item.connected === false
                        ? "You’re no longer connected."
                        : "You connected. Say hello!")}
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
            {!loading && items.length > 0 && !filteredItems.length && (
              <p className="px-4 py-8 text-center text-sm text-matcha-muted">
                No conversations match “{query}”.
              </p>
            )}
          </div>
        </aside>

        <div
          className={`${selectedId ? "flex" : "hidden min-[841px]:flex"} min-h-0 min-w-0 flex-col overflow-hidden`}
        >
          {selected ? (
            <>
              <header className="flex min-h-[74px] shrink-0 items-center gap-3 border-b border-matcha-border px-4 py-3 sm:px-6">
                <UiButton
                  disabled={recording}
                  className="!size-10 !min-h-10 !min-w-10 !rounded-full !p-0 min-[841px]:hidden"
                  aria-label="Back to conversations"
                  onClick={() => setSearchParams({})}
                >
                  <ArrowLeft size={18} />
                </UiButton>
                <button
                  type="button"
                  disabled={recording}
                  className="flex min-w-0 cursor-pointer items-center gap-3 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent"
                  aria-label={`View ${fullName(selected)}’s profile`}
                  onClick={() => void run(() => openProfile(selected.id))}
                >
                  {selected.photo_id ? (
                    <img
                      className="size-11 rounded-full object-cover"
                      src={`/api/v1/photos/${selected.photo_id}`}
                      alt=""
                    />
                  ) : (
                    <span className="grid size-11 place-items-center rounded-full bg-matcha-raised text-matcha-accent">
                      <User size={18} />
                    </span>
                  )}
                  <span className="min-w-0">
                    <strong className="block truncate text-base font-semibold text-matcha-text">
                      {fullName(selected)}
                    </strong>
                    <span className="flex items-center gap-1.5 text-xs text-matcha-muted">
                      <span
                        className={`size-2 rounded-full ${selected.online ? "bg-emerald-500" : "bg-matcha-muted/60"}`}
                      />
                      {selected.online ? "Online" : "Offline"}
                    </span>
                  </span>
                </button>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={
                      recording ||
                      sending ||
                      !selected.connected ||
                      !selected.online
                    }
                    aria-label="Start audio call"
                    title="Audio call"
                    className="grid size-10 shrink-0 place-items-center rounded-full border border-matcha-border bg-matcha-surface text-matcha-text hover:bg-matcha-raised disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() =>
                      void run(() =>
                        startCall(selected.id, selected.first_name, "audio"),
                      )
                    }
                  >
                    <Phone size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={
                      recording ||
                      sending ||
                      !selected.connected ||
                      !selected.online
                    }
                    aria-label="Start video call"
                    title="Video call"
                    className="grid size-10 shrink-0 place-items-center rounded-full border border-matcha-border bg-matcha-surface text-matcha-text hover:bg-matcha-raised disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() =>
                      void run(() =>
                        startCall(selected.id, selected.first_name, "video"),
                      )
                    }
                  >
                    <Video size={18} aria-hidden="true" />
                  </button>
                  <Dropdown>
                    <Dropdown.Trigger
                      isDisabled={recording || sending}
                      aria-label="More conversation actions"
                      className="grid size-10 shrink-0 place-items-center rounded-full border border-matcha-border bg-matcha-surface text-matcha-text hover:bg-matcha-raised"
                    >
                      <MoreHorizontal size={20} />
                    </Dropdown.Trigger>
                    <Dropdown.Popover placement="bottom end">
                      <Dropdown.Menu
                        className="min-w-48 p-1.5"
                        onAction={(action) => {
                          if (action === "block") {
                            void run(async () => {
                              await api(
                                `/profiles/${selected.id}/block`,
                                "POST",
                              );
                              await changed();
                              setSearchParams({});
                            });
                          }
                          if (action === "report") {
                            void run(async () => {
                              await api(
                                `/profiles/${selected.id}/reports`,
                                "POST",
                                {
                                  reason: "Suspected fake account",
                                },
                              );
                              notify(
                                "Your report has been received. Thank you.",
                              );
                            });
                          }
                        }}
                      >
                        <Dropdown.Item
                          id="block"
                          className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-matcha-text"
                        >
                          <Ban size={17} /> Block
                        </Dropdown.Item>
                        <Dropdown.Item
                          id="report"
                          className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-matcha-text"
                        >
                          <Flag size={17} /> Report fake
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                </div>
              </header>
              <div
                ref={messageLog}
                onScroll={(event) => {
                  const log = event.currentTarget;
                  stickToBottom.current =
                    log.scrollHeight - log.clientHeight - log.scrollTop <= 80;
                }}
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6"
                role="log"
                aria-label={`Conversation with ${selected.first_name}`}
                aria-live="polite"
                aria-relevant="additions text"
              >
                {nextBefore && (
                  <UiButton
                    className="mx-auto min-h-9 rounded-full px-4 text-xs"
                    disabled={loadingOlder}
                    onClick={() => void run(loadOlder)}
                  >
                    {loadingOlder
                      ? "Loading earlier messages…"
                      : "Load earlier messages"}
                  </UiButton>
                )}
                {selected.connected_at && (
                  <p className="mx-auto my-1 rounded-full border border-matcha-border bg-matcha-accent/5 px-4 py-2 text-center text-xs text-matcha-muted">
                    You connected on{" "}
                    {new Date(selected.connected_at).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {selected.common_tags} common{" "}
                    {selected.common_tags === 1 ? "interest" : "interests"}
                  </p>
                )}
                {threadLoading && !messages.length && (
                  <p className="m-auto text-sm text-matcha-muted" role="status">
                    Loading messages…
                  </p>
                )}
                {!threadLoading && !messages.length && (
                  <p className="m-auto max-w-xs text-center text-sm text-matcha-muted">
                    {canMessage
                      ? "You’re connected. Send a hello to get the conversation started."
                      : "No messages in this conversation."}
                  </p>
                )}
                {messages.map((message, index) => {
                  const newDay =
                    !index ||
                    messageDay(messages[index - 1].created_at) !==
                      messageDay(message.created_at);
                  const own = message.actor !== selected.id;
                  const automaticBody = message.attachment
                    ? message.attachment.kind === "photo"
                      ? "Photo"
                      : message.attachment.kind === "voice"
                        ? "Voice message"
                        : message.attachment.name
                    : null;
                  const document =
                    message.attachment?.kind === "document"
                      ? attachmentDisplay(
                          message.attachment.name,
                          message.attachment.content_type,
                        )
                      : null;
                  const showBody =
                    !message.attachment || message.body !== automaticBody;
                  const parts = showBody ? messageParts(message.body) : [];
                  const preview = parts.find(
                    (part): part is Extract<MessagePart, { type: "link" }> =>
                      part.type === "link",
                  );
                  const standaloneLink =
                    Boolean(preview) &&
                    parts.every(
                      (part) => part.type === "link" || !part.value.trim(),
                    );
                  const previewDetails = preview
                    ? linkPreviewDetails(preview.href)
                    : null;
                  return (
                    <Fragment key={message.id}>
                      {newDay && (
                        <div className="my-2 flex items-center gap-3 text-[10px] font-bold tracking-[1.8px] text-matcha-muted">
                          <span className="h-px flex-1 bg-matcha-border" />
                          <span>
                            {messageDay(message.created_at).toUpperCase()}
                          </span>
                          <span className="h-px flex-1 bg-matcha-border" />
                        </div>
                      )}
                      <article
                        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 ${own ? "self-end rounded-br-md bg-matcha-accent text-[var(--accent-foreground)]" : "self-start rounded-bl-md bg-matcha-raised text-matcha-text"}`}
                      >
                        {message.attachment?.kind === "photo" && (
                          <img
                            className="mb-1 max-h-80 max-w-full rounded-xl object-contain"
                            src={`/api/v1/conversations/${selected.id}/messages/${message.id}/attachment`}
                            alt="Photo attachment"
                          />
                        )}
                        {message.attachment?.kind === "voice" && (
                          <VoiceMessagePlayer
                            own={own}
                            src={`/api/v1/conversations/${selected.id}/messages/${message.id}/attachment`}
                          />
                        )}
                        {document &&
                          message.attachment?.kind === "document" && (
                            <a
                              className={`mb-1 flex w-[min(19rem,70vw)] min-w-0 items-center gap-3 rounded-xl p-3 no-underline transition-colors ${own ? "bg-black/10 text-[var(--accent-foreground)] hover:bg-black/15" : "bg-matcha-bg text-matcha-text hover:bg-matcha-raised"}`}
                              href={`/api/v1/conversations/${selected.id}/messages/${message.id}/attachment`}
                              download={message.attachment.name}
                              title={message.attachment.name}
                            >
                              <span
                                className={`grid size-10 shrink-0 place-items-center rounded-lg ${own ? "bg-white/15" : "bg-matcha-raised text-matcha-accent"}`}
                              >
                                <FileText size={20} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <strong className="block truncate text-sm font-medium">
                                  {document.name}
                                </strong>
                                <span className="mt-1 block text-[11px] opacity-70">
                                  {document.type} ·{" "}
                                  {formatBytes(message.attachment.size)}
                                </span>
                              </span>
                            </a>
                          )}
                        {showBody && !standaloneLink && (
                          <p
                            className={`m-0 text-sm leading-relaxed ${own ? "text-[var(--accent-foreground)]" : "text-matcha-text"}`}
                          >
                            {parts.map((part, partIndex) =>
                              part.type === "link" ? (
                                <a
                                  key={`${part.href}-${partIndex}`}
                                  href={part.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="cursor-pointer underline underline-offset-2"
                                >
                                  {part.value}
                                </a>
                              ) : (
                                <Fragment key={partIndex}>
                                  {part.value}
                                </Fragment>
                              ),
                            )}
                          </p>
                        )}
                        {preview && previewDetails && (
                          <a
                            href={preview.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`mt-2 flex w-[min(22rem,70vw)] min-w-0 items-center gap-3 rounded-xl p-3 no-underline transition-colors ${own ? "bg-black/10 text-[var(--accent-foreground)] hover:bg-black/15" : "bg-matcha-surface text-matcha-text hover:bg-matcha-bg"}`}
                            title={preview.href}
                          >
                            <span
                              className={`grid size-10 shrink-0 place-items-center rounded-lg ${own ? "bg-white/15" : "bg-matcha-accent/10 text-matcha-accent"}`}
                            >
                              <Link2 size={19} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <strong className="block truncate text-sm font-semibold">
                                {previewDetails.host}
                              </strong>
                              <span className="mt-1 block truncate text-xs opacity-70">
                                {previewDetails.address}
                              </span>
                            </span>
                            <ExternalLink
                              size={15}
                              className="shrink-0 opacity-60"
                              aria-hidden="true"
                            />
                          </a>
                        )}
                        <span className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
                          <time dateTime={message.created_at}>
                            {new Date(message.created_at).toLocaleTimeString(
                              [],
                              { hour: "numeric", minute: "2-digit" },
                            )}
                          </time>
                          {own && (
                            <CheckCheck
                              size={13}
                              aria-label={message.is_read ? "Read" : "Sent"}
                            />
                          )}
                        </span>
                      </article>
                    </Fragment>
                  );
                })}
              </div>
              {canMessage && peerTyping && (
                <div
                  role="status"
                  aria-label={`${selected.first_name} is typing`}
                  className="flex h-9 shrink-0 items-center gap-2 px-5 text-matcha-muted"
                >
                  <span className="flex items-center gap-1" aria-hidden="true">
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        className="size-1.5 animate-bounce rounded-full bg-matcha-accent"
                        style={{ animationDelay: `${dot * 120}ms` }}
                      />
                    ))}
                  </span>
                  <span className="text-xs">
                    {selected.first_name} is typing
                  </span>
                </div>
              )}
              {!canMessage ? (
                <div
                  role="status"
                  className="flex shrink-0 items-start gap-3 border-t border-matcha-border bg-matcha-raised/50 p-4 text-sm text-matcha-muted sm:px-6"
                >
                  <LockKeyhole
                    size={19}
                    className="mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <strong className="block font-semibold text-matcha-text">
                      You’re no longer connected
                    </strong>
                    <p className="mb-0 mt-1 text-sm">
                      One of you removed their interest. Your conversation
                      history is still available, but you can’t send messages
                      unless you both like each other again.
                    </p>
                  </div>
                </div>
              ) : (
                <form
                  className="shrink-0 border-t border-matcha-border p-3 sm:p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(send);
                  }}
                >
                  <input
                    ref={documentInput}
                    className="hidden"
                    type="file"
                    aria-label="Choose a document to attach"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file)
                        void run(() => sendAttachment(file, "document"));
                    }}
                  />
                  <div className="relative flex min-h-14 items-center gap-1.5 rounded-full border border-matcha-border bg-matcha-bg py-1 pl-2 pr-2 sm:gap-2 sm:pl-3">
                    {recording ? (
                      <button
                        type="button"
                        onClick={toggleVoicePause}
                        aria-label={
                          recordingPaused
                            ? "Resume recording"
                            : "Pause recording"
                        }
                        title={
                          recordingPaused
                            ? "Resume recording"
                            : "Pause recording"
                        }
                        className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-matcha-muted transition-colors hover:bg-matcha-raised hover:text-matcha-text"
                      >
                        {recordingPaused ? (
                          <Play size={18} />
                        ) : (
                          <Pause size={18} />
                        )}
                      </button>
                    ) : (
                      <Dropdown>
                        <Dropdown.Trigger
                          type="button"
                          aria-label="Attach a file"
                          className="grid size-10 shrink-0 place-items-center rounded-full text-matcha-muted transition-colors hover:bg-matcha-raised hover:text-matcha-text"
                          isDisabled={sending || recording}
                        >
                          <Paperclip size={19} />
                        </Dropdown.Trigger>
                        <Dropdown.Popover placement="top start">
                          <Dropdown.Menu
                            className="min-w-44 p-1.5"
                            onAction={(action) => {
                              if (action === "camera") {
                                setCameraReady(false);
                                setCameraOpen(true);
                              }
                              if (action === "document")
                                documentInput.current?.click();
                            }}
                          >
                            <Dropdown.Item
                              id="camera"
                              className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-matcha-text"
                            >
                              <Camera size={17} /> Camera
                            </Dropdown.Item>
                            <Dropdown.Item
                              id="document"
                              className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-matcha-text"
                            >
                              <Paperclip size={17} /> Document
                            </Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown>
                    )}
                    {recording ? (
                      <button
                        type="button"
                        onClick={cancelVoice}
                        aria-label="Cancel recording"
                        title="Cancel recording"
                        className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-matcha-muted transition-colors hover:bg-matcha-raised hover:text-matcha-text"
                      >
                        <X size={18} />
                      </button>
                    ) : (
                      <Popover>
                        <Popover.Trigger
                          aria-label="Choose an emoji"
                          className="grid size-10 shrink-0 place-items-center rounded-full text-matcha-muted transition-colors hover:bg-matcha-raised hover:text-matcha-text"
                        >
                          <Smile size={19} />
                        </Popover.Trigger>
                        <Popover.Content placement="top start">
                          <Popover.Dialog className="overflow-hidden rounded-2xl border border-matcha-border bg-matcha-surface p-1 shadow-xl">
                            <Suspense
                              fallback={
                                <div className="grid h-[390px] w-[min(360px,calc(100vw-32px))] place-items-center text-sm text-matcha-muted">
                                  Loading emojis…
                                </div>
                              }
                            >
                              <EmojiPicker
                                colorScheme={resolvedTheme}
                                emojiStyle="native"
                                width="min(360px, calc(100vw - 32px))"
                                height={390}
                                className="matcha-emoji-picker"
                                style={
                                  {
                                    "--epr-bg-color": "var(--surface)",
                                    "--epr-category-label-bg-color":
                                      "var(--surface)",
                                    "--epr-search-input-bg-color":
                                      "var(--app-bg)",
                                    "--epr-search-input-bg-color-active":
                                      "var(--app-bg)",
                                    "--epr-picker-border-color":
                                      "var(--border)",
                                    "--epr-text-color": "var(--text)",
                                    "--epr-category-label-text-color":
                                      "var(--text)",
                                    "--epr-highlight-color": "var(--accent)",
                                    "--epr-hover-bg-color":
                                      "var(--surface-raised)",
                                    "--epr-focus-bg-color":
                                      "var(--surface-raised)",
                                    "--epr-search-border-color":
                                      "var(--border)",
                                    "--epr-search-border-color-active":
                                      "var(--accent)",
                                    "--epr-search-input-text-color":
                                      "var(--text)",
                                    "--epr-search-input-placeholder-color":
                                      "var(--muted)",
                                    "--epr-category-icon-active-color":
                                      "var(--accent)",
                                    "--epr-category-icon-inactive-color":
                                      "var(--muted)",
                                    "--epr-preview-border-color":
                                      "var(--border)",
                                    "--epr-preview-text-color": "var(--muted)",
                                    "--epr-emoji-variation-indicator-color":
                                      "var(--accent)",
                                    "--epr-emoji-variation-picker-bg-color":
                                      "var(--surface)",
                                    "--epr-skin-tone-outer-border-color":
                                      "var(--border)",
                                    "--epr-skin-tone-inner-border-color":
                                      "var(--surface)",
                                    "--epr-skin-tone-picker-menu-color":
                                      "var(--surface)",
                                  } as CSSProperties
                                }
                                onEmojiClick={({ emoji }) => {
                                  setDraft((current) => current + emoji);
                                }}
                              />
                            </Suspense>
                          </Popover.Dialog>
                        </Popover.Content>
                      </Popover>
                    )}
                    {recording ? (
                      <RecordingWaveform
                        seconds={recordingSeconds}
                        paused={recordingPaused}
                        stream={voiceStream.current}
                      />
                    ) : (
                      <input
                        type="text"
                        aria-label="Message"
                        placeholder={`Message ${fullName(selected)}…`}
                        maxLength={4000}
                        value={draft}
                        onChange={(event) => changeDraft(event.target.value)}
                        disabled={sending}
                        className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm font-normal text-matcha-text outline-none placeholder:text-matcha-muted/70"
                      />
                    )}
                    <button
                      type="button"
                      aria-label={
                        recording
                          ? "Stop and send voice message"
                          : "Record voice message"
                      }
                      title={
                        recording
                          ? "Stop and send voice message"
                          : "Record voice message"
                      }
                      disabled={sending}
                      onClick={() => void toggleVoiceRecording()}
                      className={`grid size-10 shrink-0 cursor-pointer place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent disabled:cursor-wait disabled:opacity-50 ${recording ? "text-matcha-accent" : "text-matcha-muted hover:bg-matcha-raised hover:text-matcha-text"}`}
                    >
                      {recording ? <Send size={17} /> : <Mic size={18} />}
                    </button>
                  </div>
                  <p className="sr-only" aria-live="polite">
                    {recording
                      ? `Recording voice message, ${recordingSeconds} seconds.`
                      : ""}
                  </p>
                </form>
              )}
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
      <Modal
        isOpen={cameraOpen}
        onOpenChange={(open) => {
          if (!open) setCameraOpen(false);
        }}
      >
        <Modal.Backdrop
          className="fixed inset-0 z-[1600] bg-black/60 backdrop-blur-sm"
          isDismissable
        >
          <Modal.Container
            placement="center"
            scroll="outside"
            size="lg"
            className="z-[1601] p-3 sm:p-6"
          >
            <Modal.Dialog className="relative flex w-[min(560px,calc(100vw-24px))] flex-col gap-4 rounded-3xl border border-matcha-border bg-matcha-surface p-5 text-matcha-text shadow-2xl sm:p-6">
              <Modal.Header className="p-0">
                <Modal.Heading className="m-0 text-xl font-semibold">
                  Take a photo
                </Modal.Heading>
              </Modal.Header>
              {cameraError ? (
                <p
                  className="m-0 rounded-xl bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger-text)]"
                  role="alert"
                >
                  {cameraError}
                </p>
              ) : (
                <video
                  ref={cameraVideo}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={() => setCameraReady(true)}
                  className="max-h-[60vh] w-full rounded-2xl bg-black object-contain"
                />
              )}
              <Modal.Footer className="flex justify-end gap-2 p-0">
                <UiButton type="button" onClick={() => setCameraOpen(false)}>
                  Cancel
                </UiButton>
                <UiButton
                  type="button"
                  variant="primary"
                  disabled={!cameraReady || sending}
                  onClick={() => void capturePhoto()}
                  className="!border-matcha-accent !bg-matcha-accent !text-white"
                >
                  <ImagePlus size={17} /> Use photo
                </UiButton>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </section>
  );
}
