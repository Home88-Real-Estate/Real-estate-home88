/**
 * Greek to Latin letters for place names in English listing text ("Γλυφάδα" -> "Glyfada"), after the
 * ELOT 743 / ISO 843 conventions used on Greek road signs. Deterministic: no model is asked.
 */

const PAIRS: Array<[string, string]> = [
  ["ου", "ou"], ["αι", "ai"], ["ει", "ei"], ["οι", "oi"], ["υι", "yi"],
  ["γγ", "ng"], ["γκ", "gk"], ["γξ", "nx"], ["γχ", "nch"], ["ντ", "nt"], ["μπ", "mp"],
  ["θ", "th"], ["χ", "ch"], ["ψ", "ps"],
];
const SINGLE: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o",
  π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", ω: "o",
};
// αυ/ευ/ηυ: "v" before a vowel or voiced consonant, "f" otherwise.
const VOICED = new Set([..."αεηιουωβγδζλμνρ"]);

export function toLatin(text: string): string {
  const plain = text.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  let out = "";
  for (let i = 0; i < plain.length; ) {
    const ch = plain[i]!;
    const lower = ch.toLocaleLowerCase("el");
    const upper = ch !== lower;
    const two = (lower + (plain[i + 1] ?? "")).toLocaleLowerCase("el");
    let latin: string | undefined;
    let used = 1;
    if (["αυ", "ευ", "ηυ"].includes(two)) {
      const next = (plain[i + 2] ?? "").toLocaleLowerCase("el");
      latin = (SINGLE[lower] ?? "") + (VOICED.has(next) ? "v" : "f");
      used = 2;
    } else {
      const pair = PAIRS.find(([g]) => g === two) ?? (PAIRS.find(([g]) => g === lower && g.length === 1));
      if (pair && pair[0].length === 2) {
        latin = pair[1];
        used = 2;
      } else if (pair) {
        latin = pair[1];
      } else {
        latin = SINGLE[lower];
      }
    }
    if (latin === undefined) {
      out += ch;
      i += 1;
      continue;
    }
    out += upper ? latin[0]!.toUpperCase() + latin.slice(1) : latin;
    i += used;
  }
  return out;
}
