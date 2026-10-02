"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { CRM_BASE_PATH } from "@/lib/paths";

/**
 * Greek messages keyed by HTTP status. The API's own messages are English and
 * deliberately vague (no account oracle); these say the same, for staff.
 */
function messageFor(status: number): string {
  if (status === 401) return "Λάθος email ή κωδικός πρόσβασης.";
  if (status === 403) return "Ο λογαριασμός δεν είναι ενεργός. Επικοινωνήστε με τον διαχειριστή.";
  if (status === 429) return "Πολλές προσπάθειες σύνδεσης. Δοκιμάστε ξανά σε λίγα λεπτά.";
  if (status === 400 || status === 422) return "Ελέγξτε ότι συμπληρώσατε σωστά το email και τον κωδικό.";
  return "Η υπηρεσία δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά σε λίγο.";
}

export function LoginForm() {
  const router = useRouter();
  const password = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<{ message: string; credentials: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${CRM_BASE_PATH}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
        }),
      });

      if (!response.ok) {
        setError({ message: messageFor(response.status), credentials: response.status === 401 });
        setPending(false);
        password.current?.select();
        return;
      }

      // The session cookie is set by the response; re-render the guarded app.
      router.replace("/");
      router.refresh();
    } catch {
      setError({ message: messageFor(0), credentials: false });
      setPending(false);
    }
  }

  const onKey = (event: React.KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(event.getModifierState?.("CapsLock") ?? false);

  return (
    <form onSubmit={onSubmit}>
      {error && (
        <div className="notice notice--danger" role="alert" style={{ marginBottom: 18 }}>
          {error.message}
        </div>
      )}

      <div className="field">
        <label htmlFor="email">Email</label>
        <div className="input-wrap">
          <Icon name="mail" size={17} />
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            className="input"
            autoComplete="username"
            placeholder="onoma@home88.gr"
            aria-invalid={error?.credentials || undefined}
            required
            autoFocus
          />
        </div>
      </div>

      <div className="field">
        <div className="field__row">
          <label htmlFor="password">Κωδικός πρόσβασης</label>
          <Link href="/forgot-password">Ξεχάσατε τον κωδικό;</Link>
        </div>
        <div className="input-wrap input-wrap--toggle">
          <Icon name="lock" size={17} />
          <input
            ref={password}
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            className="input"
            autoComplete="current-password"
            aria-invalid={error?.credentials || undefined}
            aria-describedby={capsLock ? "caps-hint" : undefined}
            onKeyDown={onKey}
            onKeyUp={onKey}
            required
          />
          <button
            type="button"
            className="input-wrap__toggle"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Απόκρυψη κωδικού" : "Εμφάνιση κωδικού"}
            aria-pressed={showPassword}
          >
            <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
          </button>
        </div>
        {capsLock && (
          <span className="caps-hint" id="caps-hint" role="status">
            <Icon name="alert" size={14} /> Το Caps Lock είναι ενεργό
          </span>
        )}
      </div>

      <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={pending}>
        {pending ? (
          <>
            <span className="spinner" aria-hidden="true" /> Σύνδεση…
          </>
        ) : (
          "Σύνδεση"
        )}
      </button>
    </form>
  );
}
