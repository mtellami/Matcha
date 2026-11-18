import { UiButton } from "../../shared/UiButton";
import { Heart, MessageCircle, User } from "lucide-react";
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
      <div className="empty [text-align:center] [padding:50px] [background:var(--accent-soft)] [border-radius:15px] [color:var(--muted)]">
        <Heart size={32} />
        <h2>
          {sent
            ? "Keep track of a little spark"
            : "A little curiosity takes time"}
        </h2>
        <p>
          {sent
            ? "Profiles you express interest in will appear here. When they feel the same, you can chat."
            : "When someone expresses interest in you, you’ll see them here."}
        </p>
      </div>
    );
  return (
    <div className="interest-list [display:grid] [grid-template-columns:repeat(2,_minmax(0,_1fr))] [gap:16px] [&_.interest-person]:[display:flex] [&_.interest-person]:[align-items:center] [&_.interest-person]:[gap:12px] [&_.interest-person]:[padding:0] [&_.interest-person]:[border:0] [&_.interest-person]:[background:transparent] [&_.interest-person]:[max-width:100%] [&_.interest-person]:[text-align:left] [&_.interest-actions_button]:[display:flex] [&_.interest-actions_button]:[gap:8px] [&_.interest-actions_button]:[padding:9px_12px] [&_.interest-actions_button]:[font-size:12px] max-[650px]:[grid-template-columns:1fr] max-[650px]:[&_.interest-person]:[flex-wrap:nowrap]">
      {items.map((person) => (
        <article
          className="interest-card [border:1px_solid_var(--border)] [background:var(--surface)] [border-radius:14px] [padding:18px] [display:flex] [flex-direction:column] [align-items:flex-start] [gap:14px] [min-width:0] [&_.interest-note]:[font-size:11px] [&_.interest-note]:[margin:0] [&_.interest-note]:[line-height:1.5] [&_.interest-note]:[color:var(--muted)]"
          key={person.actor}
        >
          <UiButton
            className="interest-person [&__>span]:[min-width:0] [&__>span]:[overflow-wrap:anywhere] [&_strong]:[display:block] [&_strong]:[font-size:15px] [&_small]:[display:block] [&_small]:[margin:4px_0_0] [&_small]:[color:var(--muted)] [&_small]:[font-size:12px]"
            aria-label={`View ${person.first_name}’s profile`}
            onClick={() => void run(() => openProfile(person.actor))}
          >
            {person.photo_id ? (
              <img
                className="avatar [width:48px] [height:48px] [border-radius:50%] [object-fit:cover]"
                src={`/api/v1/photos/${person.photo_id}`}
                alt=""
              />
            ) : (
              <span className="avatar avatar-placeholder [width:48px] [height:48px] [border-radius:50%] [object-fit:cover] [display:flex] [align-items:center] [justify-content:center] [background:var(--accent-soft)] [flex-shrink:0]">
                <User size={24} />
              </span>
            )}
            <span>
              <strong>{person.first_name}</strong>
              <small>
                @{person.username}
                {person.city ? ` · ${person.city}` : ""}
              </small>
            </span>
          </UiButton>
          <span
            className={
              person.connected ? "interest-status connected" : "interest-status"
            }
          >
            {person.connected
              ? "Connected"
              : sent
                ? "Waiting for mutual interest"
                : "Interested in you"}
          </span>
          <div className="interest-actions [display:flex] [flex-wrap:wrap] [gap:8px]">
            {person.connected ? (
              <UiButton
                className="primary [background:var(--accent)] [color:var(--accent-foreground)] [border-color:var(--accent)] [display:flex] [align-items:center] [justify-content:center] [gap:12px] [&:hover]:[background:var(--accent-hover)]"
                onClick={() => void run(() => openProfile(person.actor))}
              >
                <MessageCircle size={16} /> Chat
              </UiButton>
            ) : (
              !sent && (
                <UiButton
                  className="primary [background:var(--accent)] [color:var(--accent-foreground)] [border-color:var(--accent)] [display:flex] [align-items:center] [justify-content:center] [gap:12px] [&:hover]:[background:var(--accent-hover)]"
                  disabled={busy}
                  onClick={() =>
                    void run(() => changeInterest(person.actor, false))
                  }
                >
                  <Heart size={16} /> Express interest
                </UiButton>
              )
            )}
            {(sent || person.connected) && (
              <UiButton
                disabled={busy}
                aria-label={`Remove interest in ${person.first_name}`}
                onClick={() =>
                  void run(() => changeInterest(person.actor, true))
                }
              >
                Remove interest
              </UiButton>
            )}
          </div>
          {person.connected && (
            <small className="interest-note">
              Removing interest will disconnect you and end this chat.
            </small>
          )}
        </article>
      ))}
    </div>
  );
}
