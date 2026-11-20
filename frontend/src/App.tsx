import { UiButton } from "./shared/UiButton";
import { BrandStatement } from "./shared/BrandStatement";
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Leaf } from "lucide-react";
import { AccountNavigation } from "./shared/AccountNavigation";
import { io, type Socket } from "socket.io-client";
import {
  startRealtime,
  type ConnectionState,
} from "./features/realtime/realtime";
import { api, ApiError, setCsrf } from "./shared/api";
import { Auth } from "./features/auth/Auth";
import { Activity } from "./features/activity/Activity";
import { Discovery } from "./features/discovery/Discovery";
import { Inbox } from "./features/inbox/Inbox";
import { ProfileDetail } from "./features/profile/ProfileDetail";
import { ProfileEditor } from "./features/profile/ProfileEditor";
import { ProfileCompletion } from "./features/profile/ProfileCompletion";
import { UserMap } from "./features/map/UserMap";
import {
  CallManager,
  type CallManagerHandle,
} from "./features/calls/CallManager";
import {
  canDiscover,
  profileSteps,
} from "./features/profile/profile-completion";
import type { Me, Profile, Runner } from "./shared/types";
import { ThemeSwitch } from "./shared/ThemeSwitch";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";

type View = "discover" | "map" | "notifications" | "inbox" | "profile";
type Summary = { notifications: number; messages: number };
const viewPaths: Record<View, string> = {
  discover: "/discover",
  map: "/map",
  notifications: "/activity",
  inbox: "/messages",
  profile: "/settings",
};
function viewFromPath(path: string): View | null {
  return (
    (Object.entries(viewPaths).find(([, route]) => route === path)?.[0] as
      View | undefined) ?? null
  );
}
function isProfileRoute(path: string) {
  return path === "/profile" || /^\/profile\/\d+$/.test(path);
}
export default function App() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const routePath = location.pathname;
  const view = viewFromPath(routePath) ?? "discover";
  const authParams = new URLSearchParams(location.search);
  const authOpen =
    ["/login", "/register"].includes(routePath) ||
    (Boolean(authParams.get("action")) && Boolean(authParams.get("token"))) ||
    authParams.has("oauth_error");
  const [me, setMe] = useState<Me | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState(""),
    [pending, setPending] = useState(0),
    [selected, setSelected] = useState<Profile | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [profileFocus, setProfileFocus] = useState<{ field: string } | null>(
    null,
  );
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
  const callManager = useRef<CallManagerHandle | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [realtimeSocket, setRealtimeSocket] = useState<Socket | null>(null);
  const profileReturnPath = useRef("/discover");
  const navigateRef = useRef(routerNavigate);
  navigateRef.current = routerNavigate;
  const routePathRef = useRef(routePath);
  routePathRef.current = routePath;
  useEffect(() => {
    if (!isProfileRoute(routePath)) setSelected(null);
  }, [routePath]);
  const busy = pending > 0;
  const redirectToLogin = useCallback(() => {
    navigateRef.current("/login", { replace: true });
    setSelected(null);
  }, []);
  const loadMe = useCallback(async () => {
    try {
      const response = await api<{ user: Me | null; csrf: string }>(
        "/me/session",
      );
      setCsrf(response.csrf);
      setMe(response.user);
      if (
        response.user &&
        ["/", "/login", "/register"].includes(routePathRef.current)
      ) {
        navigateRef.current("/discover", { replace: true });
      }
      if (
        !response.user &&
        (viewFromPath(routePathRef.current) ||
          isProfileRoute(routePathRef.current))
      ) {
        redirectToLogin();
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setCsrf("");
        setMe(null);
        setSelected(null);
        setSummary({ notifications: 0, messages: 0 });
        if (
          viewFromPath(routePathRef.current) ||
          isProfileRoute(routePathRef.current)
        )
          redirectToLogin();
      } else throw e;
    }
  }, [redirectToLogin]);
  const refreshSummary = useCallback(async () => {
    setSummary(await api<Summary>("/me/summary"));
  }, []);
  const run: Runner = useCallback(
    async (task) => {
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
          setCsrf("");
          redirectToLogin();
        }
      } finally {
        setPending((value) => value - 1);
      }
    },
    [redirectToLogin],
  );
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
          redirectToLogin();
          setError("Your session expired. Please sign in again.");
        }
      } finally {
        inFlight = false;
      }
    }
    void poll();
    const timer = setInterval(poll, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [me?.id, loadMe, redirectToLogin]);
  useEffect(() => {
    if (!me) return;
    const socket = io({ autoConnect: false });
    setRealtimeSocket(socket);
    const stop = startRealtime(
      socket,
      () => setRevision((value) => value + 1),
      () => {
        setMe(null);
        setCsrf("");
        setSummary({ notifications: 0, messages: 0 });
        setError("Your session expired. Please sign in again.");
        redirectToLogin();
      },
      setConnection,
    );
    return () => {
      stop();
      setRealtimeSocket((current) => (current === socket ? null : current));
    };
  }, [me?.id, redirectToLogin]);
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
  const openProfile = useCallback(
    async (id: number) => {
      if (!isProfileRoute(location.pathname))
        profileReturnPath.current =
          location.pathname === "/"
            ? "/discover"
            : `${location.pathname}${location.search}`;
      const person = await api<Profile>("/profiles/" + id);
      const path = id === me?.id ? "/profile" : `/profile/${id}`;
      if (location.pathname !== path) routerNavigate(path);
      setSelected(person);
    },
    [me?.id, location.pathname, location.search, routerNavigate],
  );
  const openConversation = useCallback(
    (id: number) => {
      setSelected(null);
      routerNavigate(`/messages?conversation=${id}`);
    },
    [routerNavigate],
  );
  function backFromProfile() {
    const path = profileReturnPath.current;
    routerNavigate(path);
    setSelected(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  useEffect(() => {
    if (!me || !isProfileRoute(routePath)) return;
    const match = routePath.match(/^\/profile\/(\d+)$/);
    const id = match ? Number(match[1]) : me.id;
    if (selected?.id === id) return;
    let active = true;
    api<Profile>("/profiles/" + id)
      .then((person) => {
        if (active) setSelected(person);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load this profile.",
          );
      });
    return () => {
      active = false;
    };
  }, [me?.id, routePath, selected?.id]);
  function navigate(next: View) {
    const path = viewPaths[next];
    if (location.pathname !== path) routerNavigate(path);
    setSelected(null);
    setError("");
    setFieldErrors({});
    setNotice("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function openLogin() {
    if (location.pathname !== "/login") routerNavigate("/login");
  }
  function setAuthRoute(mode: "login" | "register") {
    const path = mode === "register" ? "/register" : "/login";
    if (location.pathname !== path) routerNavigate(path);
  }
  async function loginComplete() {
    await loadMe();
    routerNavigate("/discover", { replace: true });
  }
  function editProfile(field: string) {
    navigate("profile");
    setProfileFocus({ field });
  }
  async function redeem() {
    routerNavigate("/", { replace: true });
    setLink({ action: null, token: null });
    await loadMe();
  }
  const dedicatedAuthPage =
    !me && authOpen && ["/login", "/register"].includes(routePath);
  const publicLandingPage =
    !me && routePath === "/" && !authOpen && !link.action;
  const loadingPage = <p role="status">Getting things ready…</p>;
  const landingPage = (
    <section className="mx-auto grid w-full max-w-[1100px] grid-cols-1 items-center gap-10 text-left lg:grid-cols-[1.05fr_.95fr] lg:gap-20">
      <div>
        <BrandStatement />
        <UiButton
          className="primary inline-flex [background:var(--accent)] [color:var(--accent-foreground)] [border-color:var(--accent)] [display:flex] [align-items:center] [justify-content:center] [gap:12px] [&:hover]:[background:var(--accent-hover)]"
          onClick={openLogin}
        >
          Get started <span aria-hidden="true">→</span>
        </UiButton>
      </div>
      <aside
        className="grid content-center gap-4"
        aria-label="Meet people through shared interests"
      >
        <article className="rounded-[20px] border border-matcha-border bg-matcha-surface p-6">
          <div className="flex items-center gap-3.5">
            <span className="grid size-[52px] place-items-center rounded-full bg-matcha-raised font-bold text-matcha-accent">
              YA
            </span>
            <span>
              <strong className="block text-[19px]">Yasmine, 27</strong>
              <small className="mt-1 block text-matcha-muted">
                1.2 km away
              </small>
            </span>
          </div>
          <div className="mt-[18px] flex flex-wrap gap-2">
            {["Hiking", "Film photography", "Ramen", "Board games"].map(
              (interest, index) => (
                <span
                  className={`rounded-full px-3 py-2 text-[13px] ${index < 2 ? "bg-matcha-accent/20 text-matcha-accent" : "bg-matcha-raised text-matcha-muted"}`}
                  key={interest}
                >
                  {interest}
                </span>
              ),
            )}
          </div>
          <p className="mt-[18px]">
            You both like early starts and quiet trails.
          </p>
        </article>
        <article className="flex items-center gap-4 rounded-[20px] border border-matcha-border bg-matcha-surface p-6">
          <span className="grid size-[50px] place-items-center rounded-[13px] bg-matcha-accent/20 text-[28px] text-matcha-accent">
            ⌁
          </span>
          <span>
            <strong className="block text-[19px]">Sunrise hike</strong>
            <small className="mt-1 block text-matcha-muted">
              Saturday · 6:30 am · near you
            </small>
          </span>
          <b className="ml-auto text-matcha-accent">Join</b>
        </article>
      </aside>
    </section>
  );
  const authPage = (
    <Auth
      fieldErrors={fieldErrors}
      error={error}
      onDismissError={() => {
        setError("");
        setFieldErrors({});
      }}
      key={routePath}
      initialMode={routePath === "/register" ? "register" : "login"}
      onModeChange={setAuthRoute}
      action={link.action}
      token={link.token}
      run={run}
      onLogin={loginComplete}
      onRedeemed={redeem}
      notify={setNotice}
      busy={busy}
    />
  );
  const privatePage = !me ? (
    <Navigate to="/login" replace />
  ) : selected ? (
    <ProfileDetail
      revision={revision}
      key={selected.id}
      person={selected}
      myId={me.id}
      editProfile={() => {
        setProfileFocus(null);
        navigate("profile");
      }}
      back={backFromProfile}
      run={run}
      changed={refreshSummary}
      notify={setNotice}
      busy={busy}
      startCall={(media) => {
        const manager = callManager.current;
        if (!manager)
          return Promise.reject(new Error("Calling is not available."));
        return manager.startCall(selected.id, selected.first_name, media);
      }}
      openMessage={openConversation}
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
      openConversation={openConversation}
      changed={refreshSummary}
      revision={`${revision}:${summary.notifications}`}
      unreadCount={summary.notifications}
    />
  ) : view === "inbox" ? (
    <Inbox
      run={run}
      revision={revision}
      changed={refreshSummary}
      openProfile={openProfile}
      notify={setNotice}
      socket={realtimeSocket}
    />
  ) : !canDiscover(me) ? (
    <ProfileCompletion
      variant="welcome"
      me={me}
      edit={editProfile}
      continueProfile={() => {
        const firstIncomplete = profileSteps(me).find(
          (step) => step.required && !step.done,
        );
        if (firstIncomplete) editProfile(firstIncomplete.id);
      }}
    />
  ) : view === "map" ? (
    <UserMap me={me} openProfile={openProfile} run={run} />
  ) : (
    <Discovery
      viewer={me}
      openMessage={openConversation}
      openProfile={openProfile}
      completeProfile={() => navigate("profile")}
      run={run}
    />
  );
  const profilePage = !me ? (
    <Navigate to="/login" replace />
  ) : selected ? (
    <ProfileDetail
      revision={revision}
      key={selected.id}
      person={selected}
      myId={me.id}
      editProfile={() => {
        setProfileFocus(null);
        navigate("profile");
      }}
      back={backFromProfile}
      run={run}
      changed={refreshSummary}
      notify={setNotice}
      busy={busy}
      openMessage={openConversation}
      startCall={(media) => {
        const manager = callManager.current;
        if (!manager)
          return Promise.reject(new Error("Calling is not available."));
        return manager.startCall(selected.id, selected.first_name, media);
      }}
    />
  ) : (
    <p role="status">Loading profile…</p>
  );
  return (
    <div
      className={
        dedicatedAuthPage
          ? "relative isolate flex min-h-svh flex-col bg-[var(--auth-bg)] text-matcha-text [background-image:radial-gradient(circle_at_40px_30px,color-mix(in_srgb,var(--accent)_55%,transparent)_1px,transparent_1.5px),radial-gradient(circle_at_120px_70px,color-mix(in_srgb,var(--accent)_35%,transparent)_1px,transparent_1.5px)] [background-size:230px_240px]"
          : "contents"
      }
    >
      {me && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-[1199] h-[86px] bg-matcha-bg backdrop-blur-2xl"
        />
      )}
      <header
        className={
          dedicatedAuthPage
            ? "relative z-10 flex h-[82px] shrink-0 items-center justify-between border-b border-matcha-border bg-transparent px-[3.4%]"
            : me
              ? "fixed left-1/2 top-4 z-[1200] mx-0 mt-0 flex w-[calc(100%-2rem)] max-w-[1280px] -translate-x-1/2 items-center justify-between gap-3 rounded-[24px] border border-matcha-border bg-matcha-surface/95 px-5 py-3 shadow-[0_12px_38px_var(--shadow)] backdrop-blur-2xl lg:flex-nowrap lg:px-8"
              : `sticky top-0 z-[1200] flex ${publicLandingPage ? "min-h-[82px] px-[3.4%]" : "min-h-16 px-[5%]"} items-center justify-between gap-5 border-b border-matcha-border bg-matcha-bg py-2`
        }
      >
        <Link
          className={`flex items-center gap-2 font-extrabold tracking-[-1.5px] ${dedicatedAuthPage || publicLandingPage ? "text-[26px] sm:text-[30px]" : "text-[21px] sm:text-2xl"}`}
          to="/"
        >
          <Leaf
            className={`size-5 text-matcha-accent ${dedicatedAuthPage || publicLandingPage ? "sm:size-[25px]" : "sm:size-[23px]"}`}
            size={dedicatedAuthPage || publicLandingPage ? 25 : 23}
          />
          matcha
        </Link>
        {dedicatedAuthPage ? (
          <div className="flex items-center gap-5">
            <ThemeSwitch />
            <Link
              className="text-[15px] text-matcha-muted transition-colors hover:text-matcha-accent"
              to="/"
            >
              Back to home
            </Link>
          </div>
        ) : me ? (
          <AccountNavigation
            me={me}
            view={view}
            profileActive={isProfileRoute(routePath)}
            summary={summary}
            socket={realtimeSocket}
            busy={busy}
            navigate={navigate}
            openProfile={() => void run(() => openProfile(me.id))}
            logout={() =>
              void run(async () => {
                await api("/auth/logout", "POST");
                setCsrf("");
                // Commit the cleared session with the destination route so the
                // protected profile cannot redirect to login during logout.
                startTransition(() => {
                  setMe(null);
                  setSelected(null);
                  setSummary({ messages: 0, notifications: 0 });
                  routerNavigate("/", { replace: true });
                });
              })
            }
          />
        ) : (
          <div className="ml-auto flex items-center gap-3.5 text-[13px] text-matcha-muted">
            <ThemeSwitch />
            <UiButton
              className="primary login-button [background:var(--accent)] [color:var(--accent-foreground)] [border-color:var(--accent)] [display:flex] [align-items:center] [justify-content:center] [gap:12px] [background:var(--surface-raised)] [border-color:var(--surface-raised)] [color:var(--text)] [&:hover]:[background:var(--accent-hover)] [&:hover]:[background:var(--surface)]"
              onClick={openLogin}
            >
              Login
            </UiButton>
          </div>
        )}
      </header>
      <main
        className={
          dedicatedAuthPage
            ? "relative z-10 mx-auto flex w-full flex-1 flex-col items-center justify-center px-5 py-8 sm:px-10 lg:px-12"
            : publicLandingPage
              ? "mx-auto min-h-[calc(100svh-142px)] max-w-[2200px] px-[max(45px,calc((100vw-2200px)/2))] pt-[clamp(56px,8vw,120px)] pb-[70px]"
              : !me && authOpen
                ? "mx-auto max-w-[1280px] px-5 py-5 sm:px-[45px] sm:py-[52px]"
                : me && isProfileRoute(routePath)
                  ? "profile-page mx-auto max-w-[1280px] px-5 pb-6 pt-28 sm:px-[45px] lg:flex lg:h-dvh lg:min-h-0 lg:flex-col"
                  : me && view === "map"
                    ? "mx-auto flex h-dvh min-h-0 max-w-[1280px] flex-col overflow-hidden px-5 pb-5 pt-28 sm:px-[45px]"
                    : me && view === "inbox"
                      ? "mx-auto flex h-dvh min-h-0 max-w-[1280px] flex-col overflow-hidden px-0 pb-0 pt-28 md:px-5 md:pb-5 lg:px-[45px]"
                      : me
                        ? "mx-auto min-h-[calc(100vh-180px)] max-w-[1280px] px-5 pb-20 pt-28 sm:px-[45px] lg:pt-[120px]"
                        : "mx-auto min-h-[calc(100vh-180px)] max-w-[1280px] px-[45px] py-[52px] pb-20"
        }
        aria-busy={busy}
        data-connection-state={me ? connection : undefined}
      >
        {me && connection === "reconnecting" && (
          <p
            className="connection-note [font-size:12px] [padding:10px_14px] [border:1px_solid_var(--border)] [border-radius:8px] [background:var(--accent-soft)]"
            role="status"
          >
            Reconnecting… You can keep browsing.
          </p>
        )}
        {me && <CallManager ref={callManager} />}
        {error && !dedicatedAuthPage && (
          <div
            className="mb-6 flex justify-between rounded-lg bg-[var(--danger-bg)] p-[15px] text-[var(--danger-text)]"
            role="alert"
            id="form-errors"
          >
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
            <UiButton
              aria-label="Dismiss error"
              onClick={() => {
                setError("");
                setFieldErrors({});
              }}
            >
              ×
            </UiButton>
          </div>
        )}
        {notice && (
          <div
            className={`mb-6 flex justify-between rounded-lg bg-[var(--success-bg)] p-[15px] text-[var(--success-text)] ${dedicatedAuthPage ? "w-full max-w-[1024px]" : ""}`}
            role="status"
          >
            {notice}
          </div>
        )}
        <Routes>
          <Route
            path="/"
            element={
              !ready ? (
                loadingPage
              ) : me ? (
                <Navigate to="/discover" replace />
              ) : (link.action && link.token) ||
                authParams.has("oauth_error") ? (
                authPage
              ) : (
                landingPage
              )
            }
          />
          <Route
            path="/login"
            element={
              !ready ? (
                loadingPage
              ) : me ? (
                <Navigate to="/discover" replace />
              ) : (
                authPage
              )
            }
          />
          <Route
            path="/register"
            element={
              !ready ? (
                loadingPage
              ) : me ? (
                <Navigate to="/discover" replace />
              ) : (
                authPage
              )
            }
          />
          <Route
            path="/discover"
            element={!ready ? loadingPage : privatePage}
          />
          <Route path="/map" element={!ready ? loadingPage : privatePage} />
          <Route
            path="/messages"
            element={!ready ? loadingPage : privatePage}
          />
          <Route
            path="/activity"
            element={!ready ? loadingPage : privatePage}
          />
          <Route
            path="/settings"
            element={!ready ? loadingPage : privatePage}
          />
          <Route path="/profile" element={!ready ? loadingPage : profilePage} />
          <Route
            path="/profile/:profileId"
            element={!ready ? loadingPage : profilePage}
          />
          <Route
            path="*"
            element={<Navigate to={me ? "/discover" : "/"} replace />}
          />
        </Routes>
      </main>
      {dedicatedAuthPage && (
        <footer className="relative z-10 flex min-h-[60px] shrink-0 items-center justify-between gap-5 border-t border-matcha-border px-[3.4%] py-3 text-[14px] text-matcha-muted">
          <span>© 2026 Matcha. All rights reserved.</span>
          <div className="flex items-center gap-7 text-matcha-text">
            <span>Privacy</span>
            <span>Terms</span>
          </div>
        </footer>
      )}
      {publicLandingPage && (
        <footer className="flex min-h-[60px] items-center justify-between gap-[18px] border-t border-matcha-border bg-matcha-bg px-[5%] py-[10px] text-[11px] text-matcha-text dark:bg-matcha-bg dark:text-matcha-text">
          <Link
            className="flex items-center gap-2 text-xl font-extrabold tracking-[-1.5px] text-matcha-accent"
            to="/"
          >
            <Leaf className="text-matcha-accent" size={18} />
            matcha
          </Link>
          <span>© 2026 Matcha. All rights reserved.</span>
        </footer>
      )}
    </div>
  );
}
