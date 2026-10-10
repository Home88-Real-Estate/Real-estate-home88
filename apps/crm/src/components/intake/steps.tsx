"use client";

import { Icon } from "../Icon";

export const STEPS = ["Περιγραφή", "Βασικά στοιχεία", "Χαρακτηριστικά", "Φωτογραφίες", "Έλεγχος & αποθήκευση"] as const;
const SUBTITLES = ["Φωνητική ή γραπτή", "Τύπος, περιοχή, τιμή", "Εμβαδόν, όροφος κ.λπ.", "Προαιρετικά", "Ολοκλήρωση"] as const;
export type StepIndex = 0 | 1 | 2 | 3 | 4;
export type StepState = "done" | "warn" | "todo";

/**
 * Five steps the agent can move between freely. A step shows as done only when what it asks for is really
 * there, and as needing attention when something in it waits for the agent; never by colour alone.
 */
export function Stepper({ current, states, onGo }: { current: StepIndex; states: StepState[]; onGo: (i: StepIndex) => void }) {
  return (
    <nav className="xsteps" aria-label="Βήματα καταχώρισης">
      <p className="xsteps__compact">
        Βήμα {current + 1} από {STEPS.length} · <strong>{STEPS[current]}</strong>
      </p>
      <ol className="xsteps__list">
        {STEPS.map((name, i) => {
          const state = states[i] ?? "todo";
          const here = i === current;
          return (
            <li key={name}>
              <button
                type="button"
                className={`xstep xstep--${state}${here ? " is-current" : ""}`}
                aria-current={here ? "step" : undefined}
                onClick={() => onGo(i as StepIndex)}
              >
                <span className="xstep__num" aria-hidden="true">
                  {state === "done" && !here ? <Icon name="check" size={16} /> : state === "warn" && !here ? "!" : i + 1}
                </span>
                <span className="xstep__text">
                  <span className="xstep__name">{name}</span>
                  <span className="xstep__sub">{SUBTITLES[i]}</span>
                </span>
                <span className="sr-only">{state === "done" ? " (ολοκληρώθηκε)" : state === "warn" ? " (χρειάζεται προσοχή)" : ""}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
