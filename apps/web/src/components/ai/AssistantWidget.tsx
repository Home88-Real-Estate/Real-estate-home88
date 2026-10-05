"use client";

/**
 * Floating HOME88 AI assistant: launcher + chat window.
 *
 * Talks only to this site's /api/ai/chat. Nothing here knows about Gemini, the
 * CRM or any key. Conversation text lives in this tab's sessionStorage and is
 * sent back as plain history; it is not an account and is gone with the tab.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AIAssistantMascot, type MascotState } from "./AIAssistantMascot";
import "./assistant.css";

type Card = {
  reference: string; title: string; listingType: string; status: string; propertyType: string; location: string;
  priceLabel: string; areaSqm: number | null; bedrooms: number | null; bathrooms: number | null; url: string; image: string | null;
};
type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "bot"; text: string; cards?: Card[]; received?: boolean; error?: boolean };

const GREETING =
  "Γεια σας! Είμαι ο AI Assistant της HOME88. Μπορώ να σας βοηθήσω να βρείτε ακίνητο, να μάθετε περισσότερα για ένα ακίνητο ή να ζητήσετε επικοινωνία/επίσκεψη.";
const STORE = "h88_ai_chat";
const MAX_CHARS = 1000;

function newSessionId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

function load(): { sessionId: string; messages: Msg[] } {
  try {
    const raw = sessionStorage.getItem(STORE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.sessionId === "string" && Array.isArray(parsed.messages)) return parsed;
    }
  } catch {
    /* private mode or blocked storage: start fresh */
  }
  return { sessionId: newSessionId(), messages: [] };
}

export default function AssistantWidget() {
  const pathname = usePathname() ?? "/";
  const propertyReference = /^\/property\/(H88-\d{6})/i.exec(pathname)?.[1]?.toUpperCase();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mascot, setMascot] = useState<MascotState>("idle");
  const [hover, setHover] = useState(false);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const s = load();
    setSessionId(s.sessionId);
    setMessages(s.messages);
    nextId.current = s.messages.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ sessionId, messages: messages.slice(-40) }));
    } catch {
      /* storage unavailable: the chat still works for this page view */
    }
  }, [sessionId, messages]);

  // Sit above the fixed bars the site may show (consent banner, compare bar) instead of under them.
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      let h = 0;
      document.querySelectorAll(".consent, .compare-bar").forEach((el) => { h = Math.max(h, el.getBoundingClientRect().height); });
      root.style.setProperty("--ai-offset", `${Math.round(h)}px`);
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    return () => { mo.disconnect(); window.removeEventListener("resize", update); root.style.removeProperty("--ai-offset"); };
  }, []);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages, busy, open]);

  const openChat = useCallback(() => {
    setOpen(true);
    setMascot("opening");
    setTimeout(() => setMascot("listening"), 750);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const returnFocus = useRef(false);
  const closeChat = useCallback(() => {
    returnFocus.current = true;
    setOpen(false);
    setMascot("idle");
  }, []);

  // After the launcher is back in the DOM, give it focus so keyboard users land where they started.
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      launcherRef.current?.focus();
    }
  }, [open]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, MAX_CHARS);
      if (!text || busy || !sessionId) return;

      const history = messages.filter((m) => !(m.role === "bot" && m.error)).map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.text })).slice(-12);
      setMessages((m) => [...m, { id: nextId.current++, role: "user", text }]);
      setInput("");
      setBusy(true);
      setMascot("thinking");

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), 45_000);

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text, sessionId, history, propertyReference, pageUrl: pathname, locale: "el" }),
          signal: controller.signal,
        });
        const body = await res.json().catch(() => null);
        if (!body || typeof body.message !== "string") throw new Error("bad response");
        const ok = res.ok && body.ok === true;
        setMessages((m) => [
          ...m,
          { id: nextId.current++, role: "bot", text: body.message, cards: ok ? body.properties : undefined, received: ok && body.leadCreated === true, error: !ok },
        ]);
        setMascot(!ok ? "error" : body.leadCreated ? "success" : "responding");
      } catch {
        setMessages((m) => [
          ...m,
          { id: nextId.current++, role: "bot", error: true, text: "Συγγνώμη, αντιμετωπίζω προσωρινά ένα τεχνικό πρόβλημα. Μπορείτε να δοκιμάσετε ξανά ή να επικοινωνήσετε με τη HOME88." },
        ]);
        setMascot("error");
      } finally {
        clearTimeout(timeout);
        setBusy(false);
        setTimeout(() => setMascot("listening"), 1800);
        setTimeout(() => inputRef.current?.focus(), 30);
      }
    },
    [busy, messages, pathname, propertyReference, sessionId],
  );

  const lastError = messages.at(-1)?.role === "bot" && (messages.at(-1) as Extract<Msg, { role: "bot" }>).error;

  if (!open) {
    return (
      <button
        ref={launcherRef}
        type="button"
        className="ai-launcher"
        aria-label="Άνοιγμα συνομιλίας με τον AI Assistant της HOME88"
        aria-haspopup="dialog"
        aria-expanded="false"
        onClick={openChat}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        <AIAssistantMascot size={92} state={hover ? "hover" : "idle"} />
        <span className="ai-launcher__tag" aria-hidden="true">AI</span>
      </button>
    );
  }

  return (
    <section
      className="ai-window"
      role="dialog"
      aria-label="HOME88 AI Assistant"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeChat(); } }}
    >
      <header className="ai-window__head">
        <AIAssistantMascot size={46} state={mascot} />
        <div className="ai-window__title">
          <strong>HOME88 AI Assistant</strong>
          <span>Βοηθός τεχνητής νοημοσύνης</span>
        </div>
        <button type="button" className="ai-iconbtn" aria-label="Ελαχιστοποίηση συνομιλίας" onClick={closeChat}>–</button>
        <button
          type="button"
          className="ai-iconbtn"
          aria-label="Νέα συνομιλία"
          title="Νέα συνομιλία"
          onClick={() => { abortRef.current?.abort(); setMessages([]); setSessionId(newSessionId()); setBusy(false); setMascot("listening"); inputRef.current?.focus(); }}
        >
          ↺
        </button>
      </header>

      <div ref={logRef} className="ai-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Συνομιλία">
        <div className="ai-msg ai-msg--bot">{GREETING}</div>

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ai-msg ai-msg--me">{m.text}</div>
          ) : (
            <div key={m.id} style={{ display: "contents" }}>
              <div className={`ai-msg ai-msg--bot${m.error ? " ai-msg--error" : ""}`}>{m.text}</div>
              {m.cards && m.cards.length > 0 && (
                <div className="ai-cards">
                  {m.cards.map((c) => (
                    <article key={c.reference} className="ai-card" aria-label={c.title}>
                      {c.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="ai-card__img" src={c.image} alt="" loading="lazy" decoding="async" width={92} height={92} />
                      ) : (
                        <div className="ai-card__img" aria-hidden="true" />
                      )}
                      <div className="ai-card__body">
                        <span className="ai-card__ref">{c.reference}</span>
                        <span className="ai-card__title">{c.title}</span>
                        <span>{[c.location, c.areaSqm ? `${c.areaSqm} m²` : null, c.bedrooms ? `${c.bedrooms} υπν.` : null].filter(Boolean).join(" · ")}</span>
                        <span className="ai-card__price">{c.priceLabel}</span>
                        <div className="ai-card__actions">
                          <Link className="ai-chip ai-chip--solid" href={c.url}>Προβολή</Link>
                          <button type="button" className="ai-chip" disabled={busy} onClick={() => send(`Ενδιαφέρομαι για το ακίνητο ${c.reference}.`)}>Ενδιαφέρομαι</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {m.received && <div className="ai-notice" role="status">Το αίτημά σας παρελήφθη. Ένας συνεργάτης της HOME88 θα επικοινωνήσει μαζί σας.</div>}
            </div>
          ),
        )}

        {busy && (
          <div className="ai-msg ai-msg--bot" role="status" aria-label="Ο βοηθός πληκτρολογεί">
            <span className="ai-typing" aria-hidden="true"><i /><i /><i /></span>
          </div>
        )}

        {lastError && !busy && (
          <div className="ai-fallback">
            <Link className="ai-chip ai-chip--solid" href="/contact">Επικοινωνία</Link>
            <Link className="ai-chip" href="/request">Ζητώ ακίνητο</Link>
            <Link className="ai-chip" href="/properties">Αναζήτηση ακινήτων</Link>
          </div>
        )}
      </div>

      <form
        className="ai-form"
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
      >
        <label htmlFor="ai-input" className="sr-only" style={{ position: "absolute", left: -9999 }}>Το μήνυμά σας</label>
        <textarea
          id="ai-input"
          ref={inputRef}
          rows={1}
          value={input}
          maxLength={MAX_CHARS}
          placeholder="Γράψτε μήνυμα…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); }
          }}
        />
        <button type="submit" className="ai-send" disabled={busy || input.trim() === ""}>Αποστολή</button>
      </form>
      <p className="ai-disclaimer">Απαντά ο AI Assistant της HOME88 — όχι άνθρωπος. Οι απαντήσεις βασίζονται στα δημοσιευμένα ακίνητα. Η υπηρεσία απευθύνεται σε άτομα 18 ετών και άνω.</p>
    </section>
  );
}
