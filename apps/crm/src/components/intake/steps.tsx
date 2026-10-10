"use client";

export const STEPS = ["Περιγραφή", "Βασικά στοιχεία", "Χαρακτηριστικά", "Φωτογραφίες", "Έλεγχος & αποθήκευση"] as const;
export type StepIndex = 0 | 1 | 2 | 3 | 4;

/** Five steps the agent can move between freely; a compact bar on a phone. */
export function Stepper({ current, done, onGo }: { current: StepIndex; done: boolean[]; onGo: (i: StepIndex) => void }) {
  return (
    <nav className="isteps" aria-label="Βήματα καταχώρισης">
      <p className="isteps__compact" aria-hidden="true">
        Βήμα {current + 1} από {STEPS.length} · <strong>{STEPS[current]}</strong>
      </p>
      <div className="isteps__bar" aria-hidden="true"><span style={{ width: `${((current + 1) / STEPS.length) * 100}%` }} /></div>
      <ol className="isteps__list">
        {STEPS.map((name, i) => (
          <li key={name}>
            <button
              type="button"
              className={`isteps__item${i === current ? " is-current" : ""}${done[i] ? " is-done" : ""}`}
              aria-current={i === current ? "step" : undefined}
              onClick={() => onGo(i as StepIndex)}
            >
              <span className="isteps__num">{done[i] && i !== current ? "✓" : i + 1}</span>
              <span>{name}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
