import { Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  Heart,
  Eye,
  Link2,
  Unlink,
  CalendarDays,
  Check,
  ChevronRight,
  Moon,
  Sun,
  User,
  Compass,
  LogOut,
  Map,
  MessageCircle,
  X,
} from "lucide-react";
import type { Socket } from "socket.io-client";
import { useActivityToast } from "../features/activity/useActivityToast";
import type { Me } from "./types";
import { Dropdown } from "@heroui/react";
import { useTheme } from "./theme";

const activityIcons: Record<string, typeof Bell> = {
  visit: Eye,
  like: Heart,
  match: Link2,
  message: MessageCircle,
  disconnect: Unlink,
  date_invite: CalendarDays,
  date_response: CalendarDays,
};

type Destination = "discover" | "map" | "inbox" | "notifications";
const iconButton =
  "grid shrink-0 place-items-center rounded-full border border-matcha-border bg-transparent p-0 text-matcha-muted transition-colors hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent disabled:opacity-50";

export function AccountNavigation({
  me,
  view,
  profileActive,
  summary,
  busy,
  navigate,
  openProfile,
  logout,
  socket,
}: {
  me: Me;
  view: string;
  profileActive: boolean;
  summary: { messages: number; notifications: number };
  busy: boolean;
  navigate: (view: Destination) => void;
  openProfile: () => void;
  logout: () => void;
  socket: Socket | null;
}) {
  const [toastHovered, setToastHovered] = useState(false);
  const [toastFocused, setToastFocused] = useState(false);
  const { toast, dismissToast } = useActivityToast(
    socket,
    toastHovered || toastFocused,
  );
  useEffect(() => {
    if (!toast) {
      setToastHovered(false);
      setToastFocused(false);
    }
  }, [toast]);
  const { resolvedTheme, setTheme } = useTheme();
  const themeMenu = useRef<HTMLDivElement>(null);
  const themeTrigger = useRef<HTMLButtonElement>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const drawerAnimation = useRef<Animation | null>(null);
  const [open, setOpen] = useState(false);
  const primaryPhoto = me.photos.find((photo) => photo.is_primary);
  const initials =
    [me.first_name, me.last_name]
      .filter(Boolean)
      .map((name) => name[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || me.username.slice(0, 2).toUpperCase();
  const tabs = [
    { key: "discover", label: "Discover", Icon: Compass, count: 0 },
    { key: "map", label: "Map", Icon: Map, count: 0 },
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
  ] as const;

  useEffect(() => {
    if (!themeOpen) return;
    function dismissOutside(event: PointerEvent) {
      if (!themeMenu.current?.contains(event.target as Node))
        setThemeOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [themeOpen]);

  useEffect(() => {
    if (!accountOpen) return;
    function dismiss(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setAccountOpen(false);
      requestAnimationFrame(() => accountTrigger.current?.focus());
    }
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [accountOpen]);

  useEffect(() => {
    if (!open) return;
    const dialog = drawer.current!;
    delete dialog.dataset.closing;
    dialog.showModal();
    drawerAnimation.current = dialog.animate(
      [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }],
      {
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 280,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      },
    );
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const tablet = window.matchMedia("(min-width: 768px)");
    const closeOnResize = () => {
      if (tablet.matches) closeDrawer();
    };
    tablet.addEventListener("change", closeOnResize);
    return () => {
      drawerAnimation.current?.cancel();
      dialog.close();
      root.style.overflow = overflow;
      tablet.removeEventListener("change", closeOnResize);
    };
  }, [open]);

  function closeDrawer() {
    const dialog = drawer.current;
    if (!dialog?.open || dialog.dataset.closing) return;
    dialog.dataset.closing = "true";
    const transform = getComputedStyle(dialog).transform;
    drawerAnimation.current?.cancel();
    const animation = dialog.animate(
      [{ transform }, { transform: "translateX(100%)" }],
      {
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 200,
        easing: "cubic-bezier(0.4, 0, 1, 1)",
        fill: "forwards",
      },
    );
    drawerAnimation.current = animation;
    void animation.finished
      .then(() => {
        setThemeOpen(false);
        setOpen(false);
      })
      .catch(() => {});
  }

  function act(action: () => void) {
    closeDrawer();
    action();
  }
  const avatar = primaryPhoto ? (
    <img
      className="size-full object-cover"
      src={`/api/v1/photos/${primaryPhoto.id}`}
      alt=""
    />
  ) : (
    <span className="grid size-full place-items-center bg-matcha-accent text-xs font-bold text-[var(--accent-foreground)]">
      {initials}
    </span>
  );
  const navigation = (mobile: boolean) => (
    <nav
      className={
        mobile ? "grid gap-2" : "hidden flex-1 justify-center gap-1 md:flex"
      }
      aria-label="Main navigation"
    >
      {tabs.map(({ key, label, Icon, count }) => (
        <button
          type="button"
          key={key}
          className={`relative flex h-11 min-h-11 shrink-0 items-center gap-3 rounded-full text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent ${mobile ? "px-4 text-left" : "w-11 justify-center px-0 lg:w-auto lg:px-3.5"} ${!profileActive && view === key ? "bg-matcha-accent text-[var(--accent-foreground)] shadow-[0_8px_22px_var(--shadow)]" : "text-matcha-muted hover:bg-matcha-raised"}`}
          aria-current={!profileActive && view === key ? "page" : undefined}
          aria-label={count ? `${label}, ${count} unread` : label}
          onClick={() => act(() => navigate(key))}
        >
          <span className="relative">
            <Icon size={18} aria-hidden="true" />
            {!!count && !mobile && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 size-2 rounded-full bg-matcha-accent ring-2 ring-matcha-surface lg:hidden"
              />
            )}
          </span>
          <span className={mobile ? "" : "hidden lg:inline"}>{label}</span>
          {!!count && (
            <span
              aria-hidden="true"
              className={`${mobile ? "ml-auto" : "hidden lg:inline"} rounded-full px-2 py-0.5 text-[11px] font-semibold ${!profileActive && view === key ? "bg-[var(--accent-foreground)] text-matcha-accent" : "bg-[var(--accent-soft)] text-matcha-text"}`}
            >
              {count}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
  const ToastIcon = activityIcons[toast?.kind ?? ""] ?? Bell;
  const activityToast = toast && (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onMouseEnter={() => setToastHovered(true)}
      onMouseLeave={() => setToastHovered(false)}
      onFocus={() => setToastFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setToastFocused(false);
      }}
      className={`${open ? "absolute inset-x-4 top-20" : "fixed right-4 top-24 w-[calc(100%-2rem)] max-w-sm"} z-[1400] flex items-center rounded-2xl border border-matcha-border bg-matcha-surface text-sm text-matcha-text shadow-xl`}
    >
      <Link
        to={toast.action.href}
        onClick={() => {
          dismissToast();
          closeDrawer();
        }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-4 pl-4 pr-14 text-left hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent"
      >
        <ToastIcon
          size={20}
          className="shrink-0 text-matcha-accent"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 break-words">{toast.text}</span>
      </Link>
      <button
        type="button"
        aria-label="Dismiss activity notification"
        className={`${iconButton} absolute right-3 top-1/2 size-7 -translate-y-1/2`}
        onClick={dismissToast}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
  return (
    <>
      {!open && activityToast}
      {navigation(false)}
      <div className="ml-auto hidden shrink-0 md:block">
        <Dropdown isOpen={accountOpen} onOpenChange={setAccountOpen}>
          <Dropdown.Trigger
            ref={accountTrigger}
            className={`${iconButton} size-9 min-h-9 min-w-9 overflow-hidden`}
            aria-label="Open account menu"
          >
            {avatar}
          </Dropdown.Trigger>
          <Dropdown.Popover
            placement="bottom end"
            className="!z-[1300] min-w-48 rounded-2xl border border-matcha-border bg-matcha-surface p-1.5 shadow-xl"
          >
            <Dropdown.Menu
              aria-label="Account menu"
              autoFocus="first"
              onAction={(key) => {
                if (key === "profile" || key === "logout") {
                  setAccountOpen(false);
                  if (key === "profile") openProfile();
                  else logout();
                }
              }}
            >
              <Dropdown.Item
                id="profile"
                textValue="Profile"
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-matcha-text"
              >
                <User size={16} aria-hidden="true" /> Profile
              </Dropdown.Item>
              <Dropdown.SubmenuTrigger>
                <Dropdown.Item
                  id="theme"
                  textValue="Theme"
                  className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-matcha-text"
                >
                  {resolvedTheme === "dark" ? (
                    <Moon size={16} aria-hidden="true" />
                  ) : (
                    <Sun size={16} aria-hidden="true" />
                  )}
                  Theme
                  <Dropdown.SubmenuIndicator className="ml-auto">
                    <ChevronRight size={16} />
                  </Dropdown.SubmenuIndicator>
                </Dropdown.Item>
                <Dropdown.Popover className="!z-[1301] min-w-36 rounded-2xl border border-matcha-border bg-matcha-surface p-1.5 shadow-xl">
                  <Dropdown.Menu
                    aria-label="Theme"
                    selectionMode="single"
                    selectedKeys={[resolvedTheme]}
                    onAction={(key) => {
                      if (key === "dark" || key === "light") {
                        setTheme(key);
                        setAccountOpen(false);
                      }
                    }}
                  >
                    <Dropdown.Item
                      id="light"
                      textValue="Light"
                      className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-matcha-text"
                    >
                      <Sun size={16} aria-hidden="true" /> Light
                      {resolvedTheme === "light" && (
                        <Check
                          size={15}
                          className="ml-auto"
                          aria-hidden="true"
                        />
                      )}
                    </Dropdown.Item>
                    <Dropdown.Item
                      id="dark"
                      textValue="Dark"
                      className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-matcha-text"
                    >
                      <Moon size={16} aria-hidden="true" /> Dark
                      {resolvedTheme === "dark" && (
                        <Check
                          size={15}
                          className="ml-auto"
                          aria-hidden="true"
                        />
                      )}
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.SubmenuTrigger>
              <Dropdown.Item
                id="logout"
                textValue="Log out"
                isDisabled={busy}
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-matcha-text"
              >
                <LogOut size={16} aria-hidden="true" /> Log out
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
      <button
        type="button"
        className={`${iconButton} size-9 min-h-9 min-w-9 overflow-hidden ml-auto md:hidden`}
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="mobile-navigation"
        onClick={() => setOpen(true)}
      >
        {avatar}
      </button>
      {createPortal(
        <dialog
          ref={drawer}
          id="mobile-navigation"
          aria-labelledby="mobile-navigation-title"
          onCancel={(event) => {
            event.preventDefault();
            closeDrawer();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && themeOpen) {
              event.preventDefault();
              event.stopPropagation();
              setThemeOpen(false);
              themeTrigger.current?.focus();
              return;
            }
            if (event.key !== "Tab") return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            );
            const first = buttons[0],
              last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDrawer();
          }}
          className="navigation-drawer fixed inset-y-0 left-[calc(100vw-min(280px,85vw))] right-auto m-0 h-dvh max-h-none w-[min(280px,85vw)] max-w-none border-0 border-l border-matcha-border bg-matcha-surface p-0 text-matcha-text shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
        >
          {open && activityToast}
          <div className="flex min-h-full flex-col p-6">
            <div className="mb-8 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="size-10 shrink-0 overflow-hidden rounded-full"
                  aria-hidden="true"
                >
                  {avatar}
                </span>
                <span
                  id="mobile-navigation-title"
                  className="break-words text-base font-semibold leading-snug"
                >
                  {[me.first_name, me.last_name].filter(Boolean).join(" ") ||
                    me.username}
                </span>
              </div>
              <button
                type="button"
                className={`${iconButton} size-8 min-h-8 min-w-8`}
                aria-label="Close navigation"
                autoFocus
                onClick={closeDrawer}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="mb-8">{navigation(true)}</div>
            <section
              aria-label="Account actions"
              className="mt-auto grid gap-2 border-t border-matcha-border pt-4"
            >
              <button
                type="button"
                className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-left transition-colors ${profileActive ? "bg-matcha-accent text-[var(--accent-foreground)] shadow-[0_8px_22px_var(--shadow)]" : "hover:bg-matcha-raised"}`}
                aria-current={profileActive ? "page" : undefined}
                onClick={() => act(openProfile)}
              >
                <User size={16} aria-hidden="true" />
                Profile
              </button>
              <div ref={themeMenu} className="relative w-full">
                {themeOpen && (
                  <div
                    id="drawer-theme"
                    role="group"
                    aria-label="Theme"
                    className="absolute inset-x-0 bottom-full z-20 mb-2 grid w-full gap-1 rounded-2xl border border-matcha-border bg-matcha-surface p-1.5 shadow-xl"
                  >
                    {(["light", "dark"] as const).map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        aria-pressed={resolvedTheme === theme}
                        className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-sm hover:bg-matcha-raised"
                        onClick={() => {
                          setTheme(theme);
                          setThemeOpen(false);
                          themeTrigger.current?.focus();
                        }}
                      >
                        {theme === "dark" ? (
                          <Moon size={16} />
                        ) : (
                          <Sun size={16} />
                        )}
                        {theme === "dark" ? "Dark" : "Light"}
                        {resolvedTheme === theme && (
                          <Check size={15} className="ml-auto" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-matcha-raised"
                  ref={themeTrigger}
                  aria-expanded={themeOpen}
                  aria-controls="drawer-theme"
                  onClick={() => setThemeOpen(!themeOpen)}
                >
                  {resolvedTheme === "dark" ? (
                    <Moon size={16} />
                  ) : (
                    <Sun size={16} />
                  )}{" "}
                  Theme
                  <ChevronRight
                    size={16}
                    className={`ml-auto transition-transform ${themeOpen ? "-rotate-90" : ""}`}
                  />
                </button>
              </div>
              <button
                type="button"
                className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-matcha-muted hover:bg-matcha-raised disabled:opacity-50"
                disabled={busy}
                onClick={() => act(logout)}
              >
                <LogOut size={16} aria-hidden="true" />
                Log out
              </button>
            </section>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  );
}
