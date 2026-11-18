import { UiButton } from "../../shared/UiButton";
import { Heart, User } from "lucide-react";
import type { Interest, Runner } from "../../shared/types";

export function InterestList({
  items,
  sent,
  busy,
  run,
  openProfile,
  changeInterest,
}: {
  items: Interest[];
  sent: boolean;
  busy: boolean;
  run: Runner;
  openProfile: (id: number) => Promise<void>;
  changeInterest: (id: number, remove: boolean) => Promise<void>;
}) {
  if (!items.length)
    return (
      <div className="rounded-2xl border border-matcha-border bg-matcha-surface px-5 py-12 text-center text-matcha-muted">
        <Heart className="mx-auto text-matcha-accent" size={30} />
        <h2 className="mb-2 mt-3 text-lg font-semibold text-matcha-text">
          {sent
            ? "Keep track of a little spark"
            : "A little curiosity takes time"}
        </h2>
        <p className="m-0 text-sm">
          {sent
            ? "Profiles you express interest in will appear here."
            : "When someone expresses interest in you, you’ll see them here."}
        </p>
      </div>
    );

  return (
    <div className="grid gap-2">
      {items.map((person) => {
        const name =
          [person.first_name, person.last_name].filter(Boolean).join(" ") ||
          person.username;

        return (
          <article
            className="flex min-w-0 items-center gap-3 rounded-2xl border border-matcha-border bg-matcha-surface p-3 sm:gap-4 sm:p-4"
            key={person.actor}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-matcha-accent sm:gap-4"
              aria-label={`View ${name}’s profile`}
              onClick={() => void run(() => openProfile(person.actor))}
            >
              {person.photo_id ? (
                <img
                  className="size-12 shrink-0 rounded-full object-cover"
                  src={`/api/v1/photos/${person.photo_id}`}
                  alt=""
                />
              ) : (
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-matcha-accent/10 text-matcha-accent">
                  <User size={22} />
                </span>
              )}
              <span className="min-w-0">
                <strong className="block truncate text-sm font-semibold text-matcha-text">
                  {name}
                </strong>
                <span className="mt-1 block truncate text-xs text-matcha-muted">
                  @{person.username}
                  {person.city ? ` · ${person.city}` : ""}
                </span>
              </span>
            </button>
            <UiButton
              className="min-h-9 shrink-0 rounded-full px-3 text-xs sm:px-4 sm:text-sm"
              disabled={busy}
              onClick={() => void run(() => changeInterest(person.actor, sent))}
            >
              {sent ? "Withdraw" : "Express interest"}
            </UiButton>
          </article>
        );
      })}
    </div>
  );
}
