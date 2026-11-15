import { ArrowUpRight, Check } from "lucide-react";
import { profileSteps } from "../profile-completion";
import type { Me } from "../types";

export function ProfileCompletion({ me, edit, discover }: {
  me: Me;
  edit: (field: string) => void;
  discover?: () => void;
}) {
  const steps = profileSteps(me);
  const complete = steps.filter((step) => step.done).length;
  const ready = steps.every((step) => !step.required || step.done);
  return (
    <section className="panel completion" aria-labelledby="completion-heading">
      <div className="completion-heading">
        <div>
          <div className="eyebrow">MAKE YOURSELF AT HOME</div>
          <h2 id="completion-heading">{complete === steps.length ? "Your profile is ready" : "A few details. More meaningful connections."}</h2>
          <p>{complete} of {steps.length} profile details complete. Your email and exact location stay private.</p>
        </div>
        <progress aria-label="Saved profile completion" max={steps.length} value={complete} />
      </div>
      <ul className="completion-steps">
        {steps.map((step) => (
          <li key={step.id}>
            <button type="button" onClick={() => edit(step.id)}>
              <span className={step.done ? "step-indicator done" : "step-indicator"} aria-hidden="true">{step.done ? <Check size={16} /> : <ArrowUpRight size={16} />}</span>
              <span><strong>{step.label}</strong><small>{step.done ? "Saved · Edit" : step.detail}</small></span>
              <span className="sr-only">{step.done ? "Complete" : "To do"}</span>
            </button>
          </li>
        ))}
      </ul>
      {ready && discover && <button type="button" className="primary" onClick={discover}>Discover people <ArrowUpRight size={18} /></button>}
      {!ready && <p className="completion-note">Save your profile details to start discovering people. Add a photo when you’re ready to express interest.</p>}
    </section>
  );
}
