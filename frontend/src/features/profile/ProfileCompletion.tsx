import { UiButton } from "../../shared/UiButton";
import { ArrowUpRight, Check, LockKeyhole } from "lucide-react";
import { profileSteps } from "./profile-completion";
import type { Me } from "../../shared/types";

type Props = {
  me: Me;
  edit: (field: string) => void;
  discover?: () => void;
  variant?: "welcome" | "compact";
  continueProfile?: () => void;
};

export function ProfileCompletion({
  me,
  edit,
  discover,
  variant = "compact",
  continueProfile,
}: Props) {
  const steps = profileSteps(me);
  const complete = steps.filter((step) => step.done).length;
  const ready = steps.every((step) => !step.required || step.done);

  if (variant === "welcome") {
    const groups = [
      {
        title: "THE BASICS",
        ids: [
          "profile-first-name",
          "profile-last-name",
          "profile-birth-date",
          "profile-gender",
        ],
      },
      {
        title: "ABOUT YOU",
        ids: ["profile-bio", "profile-tags", "profile-photos"],
      },
      { title: "MEETING PEOPLE", ids: ["profile-preferences", "profile-city"] },
    ];
    const circumference = 2 * Math.PI * 47;
    return (
      <section className="mx-auto grid w-full max-w-[1360px] grid-cols-1 items-start gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(310px,.85fr)] lg:gap-x-12">
        <div className="min-w-0">
          <p className="mb-4 text-[12px] font-bold tracking-[3px] text-matcha-accent">
            WELCOME TO MATCHA
          </p>
          <h1 className="my-0 text-[clamp(3rem,5.2vw,5.5rem)] font-semibold leading-[1.08] tracking-[-.055em]">
            Let’s start with <em>you.</em>
          </h1>
          <p className="mb-10 mt-5 max-w-[680px] text-[clamp(1rem,1.7vw,1.35rem)] leading-relaxed text-matcha-muted">
            A little about yourself helps us find people you’ll want to meet.
          </p>
          <div className="grid gap-8">
            {groups.map((group) => {
              const missing = group.ids
                .map((id) => steps.find((item) => item.id === id)!)
                .filter((step) => !step.done);
              if (!missing.length) return null;
              return (
                <section key={group.title} aria-label={group.title}>
                  <h2 className="mb-3 text-[12px] font-bold tracking-[2.8px] text-matcha-accent">
                    {group.title}
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {missing.map((step) => {
                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => edit(step.id)}
                          className="flex min-h-[88px] w-full items-center gap-4 rounded-[20px] border border-matcha-border bg-matcha-surface px-5 py-4 text-left text-matcha-text transition-colors hover:border-matcha-accent/50 hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent"
                        >
                          <span
                            className={`grid size-9 shrink-0 place-items-center rounded-full border ${step.done ? "border-matcha-accent bg-matcha-accent text-matcha-bg" : "border-matcha-border text-matcha-muted"}`}
                            aria-hidden="true"
                          >
                            {step.done ? <Check size={17} /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <strong className="block text-[16px] leading-snug sm:text-[18px]">
                              {step.label}
                            </strong>
                            <small className="mt-1 block text-[13px] leading-snug text-matcha-muted sm:text-[14px]">
                              {step.done ? "Saved · Edit" : step.detail}
                            </small>
                          </span>
                          <span className="shrink-0 text-[14px] font-semibold text-matcha-accent">
                            {step.done ? "Edit" : "Add"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <aside className="w-full rounded-[28px] border border-matcha-border bg-matcha-surface p-6 shadow-[0_16px_48px_var(--shadow)] sm:p-8 lg:sticky lg:top-32">
          <div className="flex flex-col items-start">
            <div
              className="relative grid size-[112px] place-items-center"
              role="img"
              aria-label={`${complete} of ${steps.length} profile details complete`}
            >
              <svg
                className="absolute inset-0 -rotate-90"
                viewBox="0 0 112 112"
                aria-hidden="true"
              >
                <circle
                  cx="56"
                  cy="56"
                  r="47"
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="8"
                />
                <circle
                  cx="56"
                  cy="56"
                  r="47"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={
                    circumference * (1 - complete / steps.length)
                  }
                />
              </svg>
              <strong className="text-[27px] font-bold text-matcha-text">
                {complete}/{steps.length}
              </strong>
            </div>
            <h2 className="mb-0 mt-6 text-[26px] font-bold leading-tight tracking-[-.03em] text-matcha-text">
              {ready
                ? "You’re ready to meet people."
                : "A few details. More meaningful connections."}
            </h2>
            <p className="mb-0 mt-3 text-[16px] leading-relaxed text-matcha-muted">
              {complete} of {steps.length} profile details complete.
            </p>
          </div>
          {ready && discover ? (
            <UiButton
              type="button"
              variant="primary"
              className="mt-7 min-h-[56px] w-full rounded-2xl !border-matcha-accent !bg-matcha-accent text-[16px] font-bold !text-matcha-bg hover:!bg-matcha-accent/90"
              onClick={discover}
            >
              Discover people <ArrowUpRight size={18} />
            </UiButton>
          ) : (
            <UiButton
              type="button"
              variant="primary"
              className="mt-7 min-h-[56px] w-full rounded-2xl !border-matcha-accent !bg-matcha-accent text-[16px] font-bold !text-matcha-bg hover:!bg-matcha-accent/90"
              onClick={continueProfile}
            >
              Save and continue <ArrowUpRight size={18} />
            </UiButton>
          )}
          <div className="mt-6 flex items-start gap-3 text-[14px] leading-relaxed text-matcha-muted">
            <LockKeyhole
              size={18}
              className="mt-0.5 shrink-0 text-matcha-accent"
              aria-hidden="true"
            />
            <p className="m-0">
              Your email and exact location stay private. Add a photo when
              you’re ready to express interest.
            </p>
          </div>
        </aside>
      </section>
    );
  }

  const missing = steps.filter((step) => !step.done);
  const circumference = 2 * Math.PI * 42;
  return (
    <section
      className="flex flex-col gap-5 rounded-3xl border border-matcha-border bg-matcha-surface p-5 shadow-[0_16px_48px_var(--shadow)] sm:p-6"
      aria-labelledby="completion-heading"
    >
      <div className="flex items-center gap-4">
        <div
          className="relative grid size-[96px] shrink-0 place-items-center"
          role="img"
          aria-label={`${complete} of ${steps.length} profile details complete`}
        >
          <svg
            className="absolute inset-0 -rotate-90"
            viewBox="0 0 96 96"
            aria-hidden="true"
          >
            <circle
              cx="48"
              cy="48"
              r="42"
              fill="none"
              stroke="var(--border)"
              strokeWidth="7"
            />
            <circle
              cx="48"
              cy="48"
              r="42"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - complete / steps.length)}
            />
          </svg>
          <strong className="text-xl font-bold text-matcha-text">
            {Math.round((complete / steps.length) * 100)}%
          </strong>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-bold tracking-[2px] text-matcha-accent">
            PROFILE PROGRESS
          </p>
          <h2
            id="completion-heading"
            className="m-0 text-xl font-semibold leading-tight tracking-tight"
          >
            {ready
              ? "You’re ready to discover."
              : "A few details. More meaningful connections."}
          </h2>
          <p className="mb-0 mt-2 text-sm leading-relaxed text-matcha-muted">
            {complete} of {steps.length} details added
          </p>
        </div>
      </div>
      <div className="h-px bg-matcha-border" />
      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-[1.5px] text-matcha-muted">
          {missing.length ? "Still to add" : "All set"}
        </h3>
        {missing.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {missing.map((step) => (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => edit(step.id)}
                  className="group flex w-full items-center gap-3 rounded-2xl border border-matcha-border bg-matcha-bg/50 px-3.5 py-3 text-left transition-colors hover:border-matcha-accent/50 hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-matcha-raised text-matcha-accent">
                    <ArrowUpRight size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm font-semibold text-matcha-text">
                      {step.label}
                    </strong>
                    <small className="mt-0.5 block text-xs leading-snug text-matcha-muted">
                      {step.detail}
                    </small>
                  </span>
                  {!step.required && step.id !== "profile-photos" && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-matcha-muted">
                      Optional
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 rounded-2xl bg-matcha-raised px-4 py-3 text-sm leading-relaxed text-matcha-muted">
            Your profile has everything people need to get to know you.
          </p>
        )}
      </div>
      {ready && discover ? (
        <UiButton
          type="button"
          variant="primary"
          className="min-h-12 w-full rounded-2xl !border-matcha-accent !bg-matcha-accent font-bold !text-matcha-bg hover:!bg-matcha-accent/90"
          onClick={discover}
        >
          Discover people <ArrowUpRight size={18} />
        </UiButton>
      ) : (
        <p className="m-0 flex items-start gap-2 text-xs leading-relaxed text-matcha-muted">
          <LockKeyhole
            size={15}
            className="mt-0.5 shrink-0 text-matcha-accent"
          />
          Your email and exact location stay private.
        </p>
      )}
    </section>
  );
}
