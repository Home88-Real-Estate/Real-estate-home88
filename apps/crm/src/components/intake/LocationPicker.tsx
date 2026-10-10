"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type PickedLocation = {
  lat: number;
  lng: number;
  accuracy: number | null;
  source: "gps" | "map" | "manual";
  visibility: "exact" | "approximate" | "private";
};

const VISIBILITY: Array<{ value: PickedLocation["visibility"]; label: string; hint: string }> = [
  { value: "approximate", label: "Κατά προσέγγιση", hint: "Ο ιστότοπος δείχνει την περιοχή (~500 μ.), όχι το κτίριο." },
  { value: "exact", label: "Ακριβής", hint: "Ο ιστότοπος δείχνει το ακριβές σημείο." },
  { value: "private", label: "Μόνο για το γραφείο", hint: "Ο ιστότοπος δεν δείχνει θέση στον χάρτη." },
];

/** Map tiles: OpenStreetMap by default; NEXT_PUBLIC_MAP_TILES="off" hides the map (GPS and typing still work). */
const TILES = process.env.NEXT_PUBLIC_MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const MAP_ENABLED = TILES !== "off";
const TILE = 256;
const ATHENS = { lat: 37.9838, lng: 23.7275 };

const worldX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};
const lngOf = (x: number, z: number) => (x / (TILE * 2 ** z)) * 360 - 180;
const latOf = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
const round7 = (n: number) => Math.round(n * 1e7) / 1e7;

/** "37.98, 23.72", "37,98 23,72" or a pasted maps link. */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const fromLink = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(text) ?? /[?&]q(?:uery)?=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(text);
  const m = fromLink ?? /(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)/.exec(text.trim());
  if (!m) return null;
  const lat = Number(m[1]!.replace(",", "."));
  const lng = Number(m[2]!.replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat: round7(lat), lng: round7(lng) };
}

function geoMessage(error: GeolocationPositionError | null): string {
  if (!error) return "Η συσκευή δεν δίνει τοποθεσία. Βάλτε τη θέση στον χάρτη ή γράψτε συντεταγμένες.";
  if (error.code === error.PERMISSION_DENIED) return "Δεν δόθηκε άδεια τοποθεσίας. Ενεργοποιήστε την από τις ρυθμίσεις του browser, ή βάλτε τη θέση στον χάρτη.";
  if (error.code === error.TIMEOUT) return "Η τοποθεσία άργησε. Δοκιμάστε ξανά σε ανοιχτό χώρο ή βάλτε τη θέση στον χάρτη.";
  return "Η τοποθεσία δεν είναι διαθέσιμη τώρα. Βάλτε τη θέση στον χάρτη ή γράψτε συντεταγμένες.";
}

function MiniMap({ center, pin, onPick }: { center: { lat: number; lng: number }; pin: { lat: number; lng: number } | null; onPick: (p: { lat: number; lng: number }) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(pin ? 17 : 13);
  const [view, setView] = useState(center);
  const [size, setSize] = useState({ w: 320, h: 240 });
  const drag = useRef<{ x: number; y: number; moved: boolean; cx: number; cy: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cx = worldX(view.lng, zoom);
  const cy = worldY(view.lat, zoom);
  const left = cx - size.w / 2;
  const top = cy - size.h / 2;
  const tiles: Array<{ key: string; x: number; y: number; url: string }> = [];
  const max = 2 ** zoom;
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + size.w) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + size.h) / TILE); ty++) {
      if (ty < 0 || ty >= max) continue;
      const wrapped = ((tx % max) + max) % max;
      tiles.push({ key: `${zoom}/${tx}/${ty}`, x: tx * TILE - left, y: ty * TILE - top, url: TILES.replace("{z}", String(zoom)).replace("{x}", String(wrapped)).replace("{y}", String(ty)) });
    }
  }

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false, cx, cy };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    if (d.moved) setView({ lat: latOf(d.cy - dy, zoom), lng: lngOf(d.cx - dx, zoom) });
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    onPick({ lat: round7(latOf(top + (e.clientY - rect.top), zoom)), lng: round7(lngOf(left + (e.clientX - rect.left), zoom)) });
  };

  const pinAt = pin ? { x: worldX(pin.lng, zoom) - left, y: worldY(pin.lat, zoom) - top } : null;
  return (
    <div className="minimap">
      <div ref={box} className="minimap__view" onPointerDown={down} onPointerMove={move} onPointerUp={up} role="application" aria-label="Χάρτης: πατήστε για να βάλετε την καρφίτσα, σύρετε για μετακίνηση">
        {tiles.map((t) => (
          // referrerPolicy: the tile server sees only the CRM's origin, never a page address.
          <img key={t.key} src={t.url} alt="" width={TILE} height={TILE} draggable={false} referrerPolicy="origin" style={{ left: t.x, top: t.y }} />
        ))}
        {pinAt && <span className="minimap__pin" style={{ left: pinAt.x, top: pinAt.y }} aria-hidden="true" />}
      </div>
      <div className="minimap__zoom">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setZoom((z) => Math.min(19, z + 1))} aria-label="Μεγέθυνση">+</button>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setZoom((z) => Math.max(5, z - 1))} aria-label="Σμίκρυνση">−</button>
        {pin && <button type="button" className="btn btn--outline btn--sm" onClick={() => setView(pin)}>Στην καρφίτσα</button>}
      </div>
      <p className="minimap__credit">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>
      </p>
    </div>
  );
}

/**
 * Where the property is: GPS on site, a pin on the map, or typed coordinates, plus what the public website
 * may show. The street address is never published; this decides only the map position on the website.
 */
export function LocationPicker({
  value,
  onChange,
  disabled,
  online = true,
  defaultCenter,
}: {
  value: PickedLocation | null;
  onChange: (next: PickedLocation | null) => void;
  disabled?: boolean;
  online?: boolean;
  defaultCenter?: { lat: number; lng: number };
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [showMap, setShowMap] = useState(false);
  const visibility = value?.visibility ?? "approximate";

  function locate() {
    if (!("geolocation" in navigator)) {
      setNote(geoMessage(null));
      return;
    }
    setBusy(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        const accuracy = Math.round(pos.coords.accuracy);
        onChange({ lat: round7(pos.coords.latitude), lng: round7(pos.coords.longitude), accuracy, source: "gps", visibility });
        if (accuracy > 100) setNote(`Ακρίβεια περίπου ±${accuracy} μ. Ελέγξτε τη θέση στον χάρτη.`);
      },
      (error) => {
        setBusy(false);
        setNote(geoMessage(error));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  function useTyped() {
    const p = parseCoordinates(typed);
    if (!p) {
      setNote("Γράψτε συντεταγμένες όπως «37.9838, 23.7275» ή επικολλήστε σύνδεσμο χάρτη.");
      return;
    }
    setNote(null);
    setTyped("");
    onChange({ ...p, accuracy: null, source: "manual", visibility });
  }

  return (
    <div className="locpick">
      <div className="locpick__actions">
        <button type="button" className="btn btn--primary btn--sm" disabled={disabled || busy} onClick={locate}>
          {busy ? "Εντοπισμός…" : value?.source === "gps" ? "Νέος εντοπισμός GPS" : "Θέση μου (GPS)"}
        </button>
        {MAP_ENABLED && (
          <button type="button" className="btn btn--outline btn--sm" disabled={disabled || !online} onClick={() => setShowMap((v) => !v)} title={online ? undefined : "Ο χάρτης χρειάζεται σύνδεση"}>
            {showMap ? "Απόκρυψη χάρτη" : "Επιλογή στον χάρτη"}
          </button>
        )}
      </div>
      {!online && MAP_ENABLED && <p className="hint">Χωρίς σύνδεση ο χάρτης δεν φορτώνει· το GPS και οι συντεταγμένες λειτουργούν κανονικά.</p>}
      {note && <p className="hint locpick__note" role="status">{note}</p>}

      {showMap && online && MAP_ENABLED && (
        <MiniMap center={value ?? defaultCenter ?? ATHENS} pin={value} onPick={(p) => onChange({ ...p, accuracy: null, source: "map", visibility })} />
      )}

      <div className="locpick__typed">
        <label htmlFor="loc-typed" className="sr-only">Συντεταγμένες</label>
        <input id="loc-typed" className="input" placeholder="ή συντεταγμένες: 37.9838, 23.7275" value={typed} disabled={disabled} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); useTyped(); } }} />
        <button type="button" className="btn btn--outline btn--sm" disabled={disabled || !typed.trim()} onClick={useTyped}>Ορισμός</button>
      </div>

      {value && (
        <div className="locpick__current">
          <p>
            <strong>{value.lat.toFixed(6)}, {value.lng.toFixed(6)}</strong>
            <span className="hint"> · {value.source === "gps" ? `GPS${value.accuracy != null ? ` ±${value.accuracy} μ.` : ""}` : value.source === "map" ? "από τον χάρτη" : "πληκτρολογήθηκε"}</span>
          </p>
          <div className="row">
            <a className="btn btn--ghost btn--sm" href={`https://www.google.com/maps/search/?api=1&query=${value.lat},${value.lng}`} target="_blank" rel="noopener noreferrer">Έλεγχος σε χάρτη</a>
            <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => onChange(null)}>Αφαίρεση θέσης</button>
          </div>
          <fieldset className="locpick__vis" disabled={disabled}>
            <legend>Τι βλέπει ο ιστότοπος</legend>
            {VISIBILITY.map((v) => (
              <label key={v.value} className={visibility === v.value ? "locpick__opt is-on" : "locpick__opt"}>
                <input type="radio" name="loc-visibility" value={v.value} checked={visibility === v.value} onChange={() => onChange({ ...value, visibility: v.value })} />
                <span><strong>{v.label}</strong><span className="hint">{v.hint}</span></span>
              </label>
            ))}
            <p className="hint">Η διεύθυνση δεν δημοσιεύεται ποτέ. Το ακριβές σημείο μένει στο γραφείο σε κάθε περίπτωση.</p>
          </fieldset>
        </div>
      )}
    </div>
  );
}
