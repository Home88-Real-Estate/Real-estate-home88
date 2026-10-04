/**
 * Mandate PDF.
 *
 * The PDF carries exactly the filled-in template text, nothing added to the
 * wording: a small header with the mandate number and type, and a footer with
 * the page number and the start of the text's SHA-256 so a printed copy can be
 * matched to the record. DejaVu Sans is embedded (subset) for Greek.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { x: 56, top: 64, bottom: 64 };
const BODY_SIZE = 10.5;
const LINE = BODY_SIZE * 1.45;

let fonts: { regular: Uint8Array; bold: Uint8Array } | null = null;

/** The font files ship in apps/api/assets/fonts; the CRM deployment traces them in. */
function loadFonts() {
  if (fonts) return fonts;
  const cwd = process.cwd();
  const candidates = [
    process.env.H88_FONT_DIR,
    path.join(cwd, "assets/fonts"),
    path.join(cwd, "apps/api/assets/fonts"),
    path.join(cwd, "../api/assets/fonts"),
    path.join(cwd, "../../apps/api/assets/fonts"),
  ].filter((p): p is string => !!p);
  const dir = candidates.find((d) => existsSync(path.join(d, "DejaVuSans.ttf")));
  if (!dir) throw new Error("Mandate PDF font not found (apps/api/assets/fonts).");
  fonts = { regular: readFileSync(path.join(dir, "DejaVuSans.ttf")), bold: readFileSync(path.join(dir, "DejaVuSans-Bold.ttf")) };
  return fonts;
}

/** Split one paragraph into lines that fit `width`; long words are broken. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  if (!text.trim()) return [""];
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) out.push(line);
    if (font.widthOfTextAtSize(word, size) <= width) {
      line = word;
      continue;
    }
    // A single word wider than the line (a long code or URL): hard-break it.
    let chunk = "";
    for (const ch of word) {
      if (font.widthOfTextAtSize(chunk + ch, size) > width) {
        out.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    line = chunk;
  }
  if (line) out.push(line);
  return out;
}

export async function renderMandatePdf(input: { title: string; number: string; text: string; checksum: string }): Promise<Buffer> {
  const f = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${input.title} ${input.number}`);
  pdf.setProducer("HOME88 CRM");
  pdf.setCreator("HOME88 CRM");
  const regular = await pdf.embedFont(f.regular, { subset: true });
  const bold = await pdf.embedFont(f.bold, { subset: true });
  const width = A4.width - MARGIN.x * 2;
  const grey = rgb(0.4, 0.42, 0.45);

  const lines: string[] = [];
  for (const paragraph of input.text.replace(/\r\n/g, "\n").split("\n")) lines.push(...wrap(paragraph, regular, BODY_SIZE, width));

  const pages = [];
  let page = pdf.addPage([A4.width, A4.height]);
  pages.push(page);
  let y = A4.height - MARGIN.top - 20;
  page.drawText(input.title, { x: MARGIN.x, y, size: 14, font: bold });
  y -= 26;
  for (const line of lines) {
    if (y < MARGIN.bottom + LINE) {
      page = pdf.addPage([A4.width, A4.height]);
      pages.push(page);
      y = A4.height - MARGIN.top - 20;
    }
    if (line) page.drawText(line, { x: MARGIN.x, y, size: BODY_SIZE, font: regular });
    y -= LINE;
  }

  pages.forEach((p, i) => {
    p.drawText(`${input.title} · ${input.number}`, { x: MARGIN.x, y: A4.height - 36, size: 8, font: regular, color: grey });
    const footer = `Σελίδα ${i + 1} / ${pages.length} · SHA-256 ${input.checksum.slice(0, 16)}…`;
    p.drawText(footer, { x: MARGIN.x, y: 30, size: 8, font: regular, color: grey });
  });

  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}
