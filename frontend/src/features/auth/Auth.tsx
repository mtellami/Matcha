import { UiInput, UiTextarea } from "../../shared/UiInput";
import { UiButton } from "../../shared/UiButton";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api, setCsrf } from "../../shared/api";
import type { Runner } from "../../shared/types";

export function Auth({
  fieldErrors,
  error,
  onDismissError,
  initialMode,
  onModeChange,
  action,
  token,
  run,
  onLogin,
  onRedeemed,
  notify,
  busy,
}: {
  fieldErrors: Record<string, string>;
  error: string;
  onDismissError: () => void;
  initialMode: "login" | "register";
  onModeChange: (mode: "login" | "register") => void;
  action: string | null;
  token: string | null;
  run: Runner;
  onLogin: () => Promise<void>;
  onRedeemed: () => Promise<void>;
  notify: (message: string) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<"login" | "register" | "reset" | "verify">(
    initialMode,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [oauthError] = useState(() => {
    const value = new URLSearchParams(location.search).get("oauth_error");
    if (value === "account_exists")
      return "An account already uses this email. Sign in with your existing method.";
    if (value === "failed" || value === "unavailable")
      return "Social sign-in could not be completed. Try again or sign in with your email.";
    return "";
  });
  useEffect(() => {
    let active = true;
    void api<{ providers: string[] }>("/auth/providers")
      .then((result) => {
        if (active) setProviders(result.providers);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    await run(async () => {
      if (action && token) {
        const result = await api("/auth/token", "POST", {
          kind: action,
          token,
          ...fields,
        });
        await onRedeemed();
        notify(result.message);
      } else if (mode === "login") {
        const result = await api<{ csrf: string }>(
          "/auth/login",
          "POST",
          fields,
        );
        setCsrf(result.csrf);
        await onLogin();
      } else {
        const result = await api(
          mode === "reset"
            ? "/auth/reset-request"
            : mode === "verify"
              ? "/auth/verification-request"
              : "/auth/register",
          "POST",
          fields,
        );
        notify(result.message);
        setMode("login");
        onModeChange("login");
      }
    });
  }
  return (
    <section className="mx-auto grid w-full max-w-[1024px] grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-[72px]">
      <div className="hidden lg:block">
        <p className="mb-4 text-[13px] font-bold tracking-[3px] text-matcha-accent">
          {mode === "register" ? "JOIN MATCHA" : "WELCOME BACK"}
        </p>
        <h1 className="my-0 text-[clamp(46px,4.2vw,60px)] font-bold leading-[1.08] tracking-[-2.5px]">
          {mode === "register" ? (
            <>
              Your people
              <br />
              <em>are waiting.</em>
            </>
          ) : (
            <>
              Good to see you.
              <br />
              <em>Pick up the spark.</em>
            </>
          )}
        </h1>
        <p className="mt-8 max-w-[475px] text-[18px] leading-[1.75] text-matcha-muted">
          {mode === "register"
            ? "Create a free account, pick your interests and start meeting people nearby."
            : "Log in to see who shares your interests and what's happening near you."}
        </p>
      </div>
      <form
        className="flex flex-col gap-5 rounded-[24px] border border-matcha-border bg-matcha-surface p-6 sm:p-8"
        onSubmit={submit}
      >
        <h2 className="mb-1 text-[28px] font-bold tracking-[-0.8px] text-matcha-text">
          {action === "verify"
            ? "Verify your email"
            : action === "email"
              ? "Confirm your new email"
              : action === "reset"
                ? "Choose a new password"
                : mode === "register"
                  ? "Create your account"
                  : mode === "reset"
                    ? "Let’s get you back in"
                    : mode === "verify"
                      ? "Resend verification email"
                      : "Log in"}
        </h2>
        {!action && mode === "register" && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-[14px] font-medium text-matcha-muted">
              <span>First name</span>
              <UiInput
                name="first_name"
                placeholder="First name"
                aria-invalid={Boolean(fieldErrors.first_name)}
                aria-describedby={
                  fieldErrors.first_name ? "form-errors" : undefined
                }
                required
                maxLength={80}
                autoComplete="given-name"
                className="h-12 rounded-[13px] border-matcha-border bg-transparent px-4 text-[15px] text-matcha-text placeholder:text-matcha-muted/60"
              />
            </label>
            <label className="grid gap-2 text-[14px] font-medium text-matcha-muted">
              <span>Last name</span>
              <UiInput
                name="last_name"
                placeholder="Last name"
                aria-invalid={Boolean(fieldErrors.last_name)}
                aria-describedby={
                  fieldErrors.last_name ? "form-errors" : undefined
                }
                required
                maxLength={80}
                autoComplete="family-name"
                className="h-12 rounded-[13px] border-matcha-border bg-transparent px-4 text-[15px] text-matcha-text placeholder:text-matcha-muted/60"
              />
            </label>
          </div>
        )}
        {error && (
          <div
            className="flex items-start justify-between gap-3 rounded-xl bg-[var(--danger-bg)] p-3.5 text-sm text-[var(--danger-text)]"
            role="alert"
            id="form-errors"
          >
            <div>
              <p className="m-0 text-[var(--danger-text)]">
                {error === "Verify your email before signing in" ? (
                  <>
                    Verify your email before signing in.{" "}
                    <button
                      type="button"
                      className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-matcha-accent underline underline-offset-2"
                      onClick={() => {
                        onDismissError();
                        setMode("verify");
                      }}
                    >
                      Resend verification email
                    </button>
                  </>
                ) : (
                  error
                )}
              </p>
              {Object.entries(fieldErrors).length > 0 && (
                <ul className="mb-0 mt-2 list-disc pl-5">
                  {Object.entries(fieldErrors).map(([field, message]) => (
                    <li key={field}>
                      <strong>{field.replaceAll("_", " ")}:</strong> {message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              className="cursor-pointer text-lg leading-none"
              aria-label="Dismiss error"
              onClick={onDismissError}
            >
              ×
            </button>
          </div>
        )}
        {!action && mode !== "login" && (
          <label className="grid gap-2 text-[14px] font-medium text-matcha-muted">
            <span>Email</span>
            <UiInput
              name="email"
              placeholder="you@example.com"
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "form-errors" : undefined}
              type="email"
              required
              autoComplete="email"
              maxLength={254}
              className="h-12 rounded-[13px] border-matcha-border bg-transparent px-4 text-[15px] text-matcha-text placeholder:text-matcha-muted/60"
            />
          </label>
        )}
        {!action && (mode === "register" || mode === "login") && (
          <label className="grid gap-2 text-[14px] font-medium text-matcha-muted">
            <span>{mode === "login" ? "Email or username" : "Username"}</span>
            <UiInput
              name={mode === "login" ? "identifier" : "username"}
              placeholder={
                mode === "login" ? "Email or username" : "Choose a username"
              }
              aria-invalid={Boolean(
                fieldErrors.username || fieldErrors.identifier,
              )}
              aria-describedby={
                fieldErrors.username || fieldErrors.identifier
                  ? "form-errors"
                  : undefined
              }
              required
              maxLength={mode === "login" ? 254 : 30}
              autoComplete="username"
              className="h-12 rounded-[13px] border-matcha-border bg-transparent px-4 text-[15px] text-matcha-text placeholder:text-matcha-muted/60"
            />
          </label>
        )}
        {(action === "reset" ||
          (!action && (mode === "login" || mode === "register"))) && (
          <label className="grid gap-2 text-[14px] font-medium text-matcha-muted">
            <span className="flex items-center justify-between gap-3">
              Password
              {!action && mode === "login" && (
                <button
                  type="button"
                  className="cursor-pointer font-medium text-matcha-accent hover:underline"
                  onClick={() => setMode("reset")}
                >
                  Forgot password?
                </button>
              )}
            </span>
            <span className="relative block w-full">
              <UiInput
                name="password"
                placeholder={
                  mode === "login" ? "Your password" : "At least 12 characters"
                }
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={
                  fieldErrors.password ? "form-errors" : undefined
                }
                type={showPassword ? "text" : "password"}
                required
                minLength={mode === "register" || action ? 12 : 1}
                maxLength={128}
                autoComplete={
                  mode === "login" && !action
                    ? "current-password"
                    : "new-password"
                }
                className="h-12 w-full rounded-[13px] border-matcha-border bg-transparent px-4 !pr-12 text-[15px] text-matcha-text placeholder:text-matcha-muted/60"
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute right-3 top-1/2 grid size-9 -translate-y-1/2 cursor-pointer place-items-center border-0 bg-transparent p-0 text-matcha-muted shadow-none transition-colors hover:bg-transparent hover:text-matcha-text focus-visible:outline-2 focus-visible:outline-matcha-accent"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
        )}
        <UiButton
          type="submit"
          variant="primary"
          className="primary mt-1 h-[52px] w-full cursor-pointer rounded-[13px] !border-matcha-accent !bg-matcha-accent text-[17px] font-bold !text-matcha-bg hover:!bg-matcha-accent/90"
          disabled={busy}
        >
          {action
            ? "Continue"
            : mode === "login"
              ? "Log in"
              : mode === "reset"
                ? "Send reset link"
                : mode === "verify"
                  ? "Send verification link"
                  : "Create account"}
        </UiButton>
        {oauthError && (
          <p
            className="oauth-error [margin:0] [color:var(--danger-text)] [font-size:13px]"
            role="alert"
          >
            {oauthError}
          </p>
        )}
        {!action && mode === "login" && providers.length > 0 && (
          <div
            className="oauth-options [display:grid] [gap:8px] [text-align:center] [&__>span]:[color:var(--muted)] [&__>span]:[font-size:12px]"
            aria-label="Social sign-in options"
          >
            <span>Or sign in with</span>
            {providers.map((provider) => (
              <a
                className="oauth-button [display:block] [padding:11px_14px] [border:1px_solid_var(--border)] [border-radius:9px] [background:var(--surface)] [color:var(--text)] [font-size:13px] [font-weight:600] [text-decoration:none] [&:hover]:[background:var(--surface-raised)]"
                href={`/api/v1/auth/${provider}`}
                key={provider}
              >
                {provider === "google" ? (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 48 48"
                    className="[display:inline-block] [width:18px] [height:18px] [vertical-align:middle] [margin-right:9px]"
                  >
                    <path
                      fill="#4285F4"
                      d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M12.6 27.7a12 12 0 0 1 0-7.4V15H5.8a20 20 0 0 0 0 18Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M24 11.9c3 0 5.7 1 7.8 3.1l5.8-5.8A19.4 19.4 0 0 0 24 4 20 20 0 0 0 5.8 15l6.8 5.3c1.6-4.8 6.1-8.4 11.4-8.4Z"
                    />
                  </svg>
                ) : null}
                Continue with {provider === "github" ? "GitHub" : "Google"}
              </a>
            ))}
          </div>
        )}
        {action && (
          <UiButton
            type="button"
            disabled={busy}
            onClick={() => void run(onRedeemed)}
          >
            Back to app
          </UiButton>
        )}
        {!action && (
          <div className="auth-links mt-1 flex flex-col items-center gap-3 text-[14px] text-matcha-muted [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-[14px] [&_button]:font-medium [&_button]:text-matcha-accent [&_button]:hover:underline">
            <p className="m-0 flex flex-wrap justify-center gap-x-1 text-center text-matcha-muted">
              <span>
                {mode === "register" ? "Already have an account?" : "New here?"}
              </span>
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 font-medium text-matcha-accent hover:underline"
                onClick={() => {
                  const next = mode === "register" ? "login" : "register";
                  setMode(next);
                  onModeChange(next);
                }}
              >
                {mode === "register" ? "Log in" : "Create an account"}
              </button>
            </p>
          </div>
        )}
      </form>
    </section>
  );
}
