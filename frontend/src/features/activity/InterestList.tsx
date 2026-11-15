import { Heart, MessageCircle, User } from "lucide-react";
import type { Interest, Runner } from "../../shared/types";

export function InterestList({ items, sent, busy, run, openProfile, changeInterest }: {
  items: Interest[];
  sent: boolean;
  busy: boolean;
  run: Runner;
  openProfile: (id: number) => Promise<void>;
  changeInterest: (id: number, remove: boolean) => Promise<void>;
}) {
  if (!items.length) return (
    <div className="empty">
      <Heart size={32} />
      <h2>{sent ? "Keep track of a little spark" : "A little curiosity takes time"}</h2>
      <p>{sent
        ? "Profiles you express interest in will appear here. When they feel the same, you can chat."
        : "When someone expresses interest in you, you’ll see them here."}</p>
    </div>
  );
  return <div className="interest-list">
    {items.map((person) => (
      <article className="interest-card" key={person.actor}>
        <button className="interest-person" aria-label={`View ${person.first_name}’s profile`}
          onClick={() => void run(() => openProfile(person.actor))}>
          {person.photo_id
            ? <img className="avatar" src={`/api/v1/photos/${person.photo_id}`} alt="" />
            : <span className="avatar avatar-placeholder"><User size={24} /></span>}
          <span><strong>{person.first_name}</strong><small>@{person.username}{person.city ? ` · ${person.city}` : ""}</small></span>
        </button>
        <span className={person.connected ? "interest-status connected" : "interest-status"}>
          {person.connected ? "Connected" : sent ? "Waiting for mutual interest" : "Interested in you"}
        </span>
        <div className="interest-actions">
          {person.connected
            ? <button className="primary" onClick={() => void run(() => openProfile(person.actor))}><MessageCircle size={16} /> Chat</button>
            : !sent && <button className="primary" disabled={busy} onClick={() => void run(() => changeInterest(person.actor, false))}><Heart size={16} /> Express interest</button>}
          {(sent || person.connected) && <button disabled={busy}
            aria-label={`Remove interest in ${person.first_name}`}
            onClick={() => void run(() => changeInterest(person.actor, true))}>Remove interest</button>}
        </div>
        {person.connected && <small className="interest-note">Removing interest will disconnect you and end this chat.</small>}
      </article>
    ))}
  </div>;
}
