import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Compass, Leaf, LogOut, MessageCircle, User } from "lucide-react";
import { io } from "socket.io-client";
import { startRealtime, type ConnectionState } from "./realtime";
import { api, ApiError, setCsrf } from "./api";
import { Auth } from "./components/Auth";
import { Activity } from "./components/Activity";
import { Discovery } from "./components/Discovery";
import { Inbox } from "./components/Inbox";
import { ProfileDetail } from "./components/ProfileDetail";
import { ProfileEditor } from "./components/ProfileEditor";
import { ProfileCompletion } from "./components/ProfileCompletion";
import { canDiscover } from "./profile-completion";
import type { Me, Profile, Runner } from "./types";

type View = "discover" | "notifications" | "inbox" | "profile";
type Summary = { notifications: number; messages: number };
export default function App() {
  const [me, setMe] = useState<Me | null>(null),
    [ready, setReady] = useState(false),
    [view, setView] = useState<View>("discover");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(0),
    [selected, setSelected] = useState<Profile | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [profileFocus, setProfileFocus] = useState<{ field: string } | null>(null);
  const [summary, setSummary] = useState<Summary>({
    notifications: 0,
    messages: 0,
  });
  const [link, setLink] = useState(() => {
    const params = new URLSearchParams(
      location.hash.length > 1 ? location.hash.slice(1) : location.search,
    );
    return { action: params.get("action"), token: params.get("token") };
  });
  const [revision, setRevision] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const tabId = useRef(crypto.randomUUID());
  const busy = pending > 0;
  const loadMe = useCallback(async () => {
    try {
      const response = await api<{ user: Me; csrf: string }>("/me");
      setCsrf(response.csrf);
      setMe(response.user);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setCsrf("");
        setMe(null);
        setSelected(null);
        setSummary({ notifications: 0, messages: 0 });
      } else throw e;
    }
  }, []);
  const refreshSummary = useCallback(async () => {
    setSummary(await api<Summary>("/me/summary"));
  }, []);
  const run: Runner = useCallback(async (task) => {
    setError("");
    setFieldErrors({});
    setNotice("");
    setPending((value) => value + 1);
    try {
      await task();
    } catch (e) {
      if (e instanceof ApiError) setFieldErrors(e.fields);
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setSelected(null);
        setCsrf("");
      }
    } finally {
      setPending((value) => value - 1);
    }
  }, []);
  useEffect(() => {
    void loadMe()
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, [loadMe]);
  useEffect(() => {
    if (!me) return;
    let active = true,
      inFlight = false;
    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        await api("/me/presence", "POST", { tab_id: tabId.current });
        const response = await api<Summary>("/me/summary");
        if (active) setSummary(response);
      } catch (e) {
        if (active && e instanceof ApiError && e.status === 403) {
          try {
            if (active) {
              setSelected(null);
              setSummary({ notifications: 0, messages: 0 });
            }
            await loadMe();
          } catch {
            /* Retry on next heartbeat. */
          }
        }
        if (active && e instanceof ApiError && e.status === 401) {
          setMe(null);
          setSelected(null);
          setError("Your session expired. Please sign in again.");
        }
      } finally {
        inFlight = false;
      }
    }
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [me?.id]);
  useEffect(() => {
    if (!me) return;
    const socket = io({ autoConnect: false });
    return startRealtime(
      socket,
      () => setRevision((value) => value + 1),
      () => {
        setMe(null);
        setSelected(null);
        setCsrf("");
        setSummary({ notifications: 0, messages: 0 });
        setError("Your session expired. Please sign in again.");
      },
      setConnection,
    );
  }, [me?.id]);
  useEffect(() => {
    if (!me) return;
    let active = true;
    api<Summary>("/me/summary")
      .then((value) => {
        if (active) setSummary(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [revision, me?.id]);
  async function openProfile(id: number) {
    const person = await api<Profile>("/profiles/" + id);
    setSelected(person);
  }
  function navigate(next: View) {
    setView(next);
    setSelected(null);
    setError("");
    setFieldErrors({});
    setNotice("");
  }
  function editProfile(field: string) {
    navigate("profile");
    setProfileFocus({ field });
  }
  async function redeem() {
    history.replaceState({}, "", "/");
    setLink({ action: null, token: null });
    await loadMe();
  }
  const tabs: {
    key: View;
    label: string;
    Icon: typeof User;
    count?: number;
  }[] = [
    { key: "discover", label: "Discover", Icon: Compass },
    {
      key: "inbox",
      label: "Messages",
      Icon: MessageCircle,
      count: summary.messages,
    },
    {
      key: "notifications",
      label: "Activity",
      Icon: Bell,
      count: summary.notifications,
    },
    { key: "profile", label: "My profile", Icon: User },
  ];
  return (
    <>
      <header>
        <a className="brand" href="/">
          <Leaf size={28} />
          matcha<span>✳</span>
        </a>
        {me && (
          <nav aria-label="Main navigation">
            {tabs.map(({ key, label, Icon, count }) => (
              <button
                className={view === key ? "active" : ""}
                aria-current={view === key ? "page" : undefined}
                aria-label={count ? `${label}, ${count} unread` : label}
                key={key}
                onClick={() => navigate(key)}
              >
                <Icon size={18} />
                {label}
                {!!count && <span className="badge">{count}</span>}
              </button>
            ))}
          </nav>
        )}
        <div className="header-right">
          {me ? (
            <>
              <span>Hello, {me.first_name}</span>
              <button
                disabled={busy}
                aria-label="Sign out"
                onClick={() =>
                  void run(async () => {
                    await api("/auth/logout", "POST");
                    setMe(null);
                    setSelected(null);
                    setCsrf("");
                    setSummary({ messages: 0, notifications: 0 });
                  })
                }
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <span>A little curiosity. A real connection.</span>
          )}
        </div>
      </header>
      <main aria-busy={busy} data-connection-state={me ? connection : undefined}>
        {me && connection === "reconnecting" && (
          <p className="connection-note" role="status">
            Reconnecting… You can keep browsing.
          </p>
        )}
        {error && (
          <div className="alert" role="alert" id="form-errors">
            <div>
              {error}
              {Object.keys(fieldErrors).length > 0 && (
                <ul>
                  {Object.entries(fieldErrors).map(([field, message]) => (
                    <li key={field}>
                      <strong>{field.replaceAll("_", " ")}:</strong> {message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              aria-label="Dismiss error"
              onClick={() => {
                setError("");
                setFieldErrors({});
              }}
            >
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="success" role="status">
            {notice}
          </div>
        )}
        {!ready ? (
          <p role="status">Getting things ready…</p>
        ) : !me || (link.action && link.token) ? (
          <Auth
            fieldErrors={fieldErrors}
            action={link.action}
            token={link.token}
            run={run}
            onLogin={loadMe}
            onRedeemed={redeem}
            notify={setNotice}
            busy={busy}
          />
        ) : selected ? (
          <ProfileDetail
            revision={revision}
            key={selected.id}
            person={selected}
            myId={me.id}
            back={() => setSelected(null)}
            run={run}
            changed={refreshSummary}
            busy={busy}
          />
        ) : view === "profile" ? (
          <ProfileEditor
            focus={profileFocus}
            edit={editProfile}
            discover={() => navigate("discover")}
            preview={() => void run(() => openProfile(me.id))}
            fieldErrors={fieldErrors}
            me={me}
            saved={loadMe}
            run={run}
            notify={setNotice}
            busy={busy}
          />
        ) : view === "notifications" ? (
          <Activity
            busy={busy}
            run={run}
            openProfile={openProfile}
            changed={refreshSummary}
            revision={`${revision}:${summary.notifications}`}
          />
        ) : view === "inbox" ? (
          <Inbox openProfile={openProfile} run={run} revision={revision} />
        ) : !canDiscover(me) ? (
          <>
            <div className="eyebrow">WELCOME TO MATCHA</div>
            <h1>Let’s start with <em>you.</em></h1>
            <p>A little about yourself helps us find people you’ll want to meet.</p>
            <ProfileCompletion me={me} edit={editProfile} />
          </>
        ) : (
          <Discovery
            openProfile={openProfile}
            completeProfile={() => navigate("profile")}
            run={run}
          />
        )}
      </main>
      <footer>
        <a className="brand" href="/">
          <Leaf size={18} />
          matcha
        </a>
        <span>Made for real connections.</span>
        <span>Take your time. Be yourself.</span>
      </footer>
    </>
  );
}
