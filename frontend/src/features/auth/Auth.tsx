import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Leaf } from "lucide-react";
import { api, setCsrf } from "../../shared/api";
import type { Runner } from "../../shared/types";

export function Auth({
  fieldErrors,
  action,
  token,
  run,
  onLogin,
  onRedeemed,
  notify,
  busy,
}: {
  fieldErrors: Record<string, string>;
  action: string | null;
  token: string | null;
  run: Runner;
  onLogin: () => Promise<void>;
  onRedeemed: () => Promise<void>;
  notify: (message: string) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState("login");
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
      }
    });
  }
  return (
    <section className="welcome">
      <div>
        <div className="eyebrow">GOOD PEOPLE. REAL POSSIBILITIES.</div>
        <h1>
          Your people.
          <br />
          <em>Your kind of spark.</em>
        </h1>
        <p>
          Shared interests. Nearby adventures. Meet someone who makes the
          everyday feel a little different.
        </p>
        <div className="organic">
          <Leaf size={100} />
          <span>
            Something good
            <br />
            starts with hello.
          </span>
        </div>
      </div>
      <form className="panel" onSubmit={submit}>
        <span className="eyebrow">A FRESH START</span>
        <h2>
          {action === "verify"
            ? "Verify your email"
            : action === "email"
              ? "Confirm your new email"
              : action === "reset"
                ? "Choose a new password"
                : mode === "register"
                  ? "Make yourself at home"
                  : mode === "reset"
                    ? "Let’s get you back in"
                    : mode === "verify"
                      ? "Resend verification email"
                      : "Welcome back"}
        </h2>
        {!action && mode === "register" && (
          <>
            <label>
              First name
              <input
                name="first_name"
                aria-invalid={Boolean(fieldErrors.first_name)}
                aria-describedby={
                  fieldErrors.first_name ? "form-errors" : undefined
                }
                required
                maxLength={80}
                autoComplete="given-name"
              />
            </label>
            <label>
              Last name
              <input
                name="last_name"
                aria-invalid={Boolean(fieldErrors.last_name)}
                aria-describedby={
                  fieldErrors.last_name ? "form-errors" : undefined
                }
                required
                maxLength={80}
                autoComplete="family-name"
              />
            </label>
          </>
        )}
        {!action && (mode === "login" || mode === "register") && (
          <label>
            Username
            <input
              name="username"
              aria-invalid={Boolean(fieldErrors.username)}
              aria-describedby={
                fieldErrors.username ? "form-errors" : undefined
              }
              required
              maxLength={30}
              autoComplete="username"
            />
          </label>
        )}
        {!action && mode !== "login" && (
          <label>
            Email
            <input
              name="email"
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "form-errors" : undefined}
              type="email"
              required
              autoComplete="email"
            />
          </label>
        )}
        {(action === "reset" ||
          (!action && (mode === "login" || mode === "register"))) && (
          <label>
            Password
            <input
              name="password"
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={
                fieldErrors.password ? "form-errors" : undefined
              }
              type="password"
              required
              minLength={mode === "register" || action ? 12 : 1}
              maxLength={128}
              autoComplete={
                mode === "login" && !action
                  ? "current-password"
                  : "new-password"
              }
            />
          </label>
        )}
        <button className="primary" disabled={busy}>
          {action
            ? "Continue"
            : mode === "login"
              ? "Sign in"
              : mode === "reset"
                ? "Send reset link"
                : mode === "verify"
                  ? "Send verification link"
                  : "Create account"}
          <ArrowUpRight size={18} />
        </button>
        {oauthError && (
          <p className="oauth-error" role="alert">
            {oauthError}
          </p>
        )}
        {!action && mode === "login" && providers.length > 0 && (
          <div className="oauth-options" aria-label="Social sign-in options">
            <span>Or sign in with</span>
            {providers.map((provider) => (
              <a
                className="oauth-button"
                href={`/api/v1/auth/${provider}`}
                key={provider}
              >
                Continue with {provider === "github" ? "GitHub" : "Google"}
              </a>
            ))}
          </div>
        )}
        {action && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(onRedeemed)}
          >
            Back to app
          </button>
        )}
        {!action && (
          <div className="auth-links">
            <button
              type="button"
              onClick={() =>
                setMode(mode === "register" ? "login" : "register")
              }
            >
              {mode === "register"
                ? "Already a member? Sign in"
                : "New here? Create an account"}
            </button>
            <button type="button" onClick={() => setMode("reset")}>
              Forgot password?
            </button>
            <button type="button" onClick={() => setMode("verify")}>
              Resend verification email
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
