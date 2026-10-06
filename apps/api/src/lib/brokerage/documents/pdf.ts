/**
 * The issued-document PDF, laid out from the document blocks.
 *
 * pdf-lib with DejaVu Sans embedded (Greek and Latin). Every character is
 * checked against the font before drawing, so a glyph the font lacks fails the
 * render instead of printing a blank box. Page breaks never split a table row,
 * a key/value row or a signature box, a table repeats its header, and a
 * section heading is never left alone at the bottom of a page.
 *
 * The output is deterministic: the same blocks and the same date give the same
 * bytes, so an issued PDF can be reproduced from its snapshot and verified by
 * checksum. A layout report lists every text item drawn, which the tests use to
 * prove nothing is clipped or overlapping.
 */

import fontkit from "@pdf-lib/fontkit";
import { pageLabel, templateReference, type Block, type DocumentSnapshot } from "@home88/domain";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { loadFonts, wrap } from "../../mandate-pdf";

export const A4 = { width: 595.28, height: 841.89 };
export const MARGIN = { left: 50, right: 50, top: 64, bottom: 62 };

export type LayoutItem = { page: number; x: number; y: number; width: number; height: number; text: string; kind: string };
export type LayoutReport = { pageCount: number; items: LayoutItem[]; unsupportedCharacters: string[] };

export class PdfRenderError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PdfRenderError";
  }
}

const BODY = 10;
const LEAD = 14;
const SMALL = 9;
const GREY = rgb(0.4, 0.42, 0.45);
const INK = rgb(0.07, 0.09, 0.12);
const LINE = rgb(0.75, 0.78, 0.82);

type Fonts = { regular: PDFFont; bold: PDFFont; regularSet: Set<number>; boldSet: Set<number> };

export async function renderDocumentPdf(input: { blocks: Block[]; snapshot: DocumentSnapshot; title: string; issuedAt: Date }): Promise<{ pdf: Buffer; layout: LayoutReport }> {
  const raw = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(raw.regular, { subset: true });
  const bold = await pdf.embedFont(raw.bold, { subset: true });
  const fonts: Fonts = { regular, bold, regularSet: new Set(regular.getCharacterSet()), boldSet: new Set(bold.getCharacterSet()) };

  pdf.setTitle(`${input.title} ${input.snapshot.number}`);
  pdf.setSubject(input.snapshot.number);
  pdf.setAuthor(input.snapshot.company.legalName ?? "HOME88");
  pdf.setProducer("HOME88 CRM");
  pdf.setCreator("HOME88 CRM");
  pdf.setKeywords([input.snapshot.kind, input.snapshot.language, `template-${input.snapshot.template.checksum.slice(0, 12)}`]);
  pdf.setCreationDate(input.issuedAt);
  pdf.setModificationDate(input.issuedAt);

  const items: LayoutItem[] = [];
  const unsupported = new Set<string>();
  const pages: PDFPage[] = [];
  const contentWidth = A4.width - MARGIN.left - MARGIN.right;
  const bottom = MARGIN.bottom;

  let page: PDFPage = pdf.addPage([A4.width, A4.height]);
  pages.push(page);
  let y = A4.height - MARGIN.top;
  const newPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    pages.push(page);
    y = A4.height - MARGIN.top;
  };

  const clean = (s: string) => s.replace(/ /g, " ").replace(/[\t\r]/g, " ");
  const check = (text: string, set: Set<number>) => {
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 32 || cp === 10) continue;
      if (!set.has(cp)) unsupported.add(ch);
    }
  };
  const lines = (text: string, font: PDFFont, size: number, width: number) =>
    clean(text).split("\n").flatMap((p) => wrap(p, font, size, width));

  const ensure = (h: number) => {
    if (y - h < bottom) newPage();
  };

  const text = (s: string, x: number, size: number, font: PDFFont, set: Set<number>, kind: string, color = INK) => {
    check(s, set);
    if (!s) return;
    page.drawText(s, { x, y: y - size, size, font, color });
    items.push({ page: pages.length, x, y: y - size - size * 0.22, width: font.widthOfTextAtSize(s, size), height: size * 1.22, text: s, kind });
  };

  // Block drawing ---------------------------------------------------------------

  const drawKv = (rows: Array<[string, string]>) => {
    const labelW = 150;
    const gap = 8;
    const valueW = contentWidth - labelW - gap;
    for (const [k, v] of rows) {
      const kl = lines(k, fonts.bold, SMALL + 0.5, labelW);
      const vl = lines(v || " ", fonts.regular, BODY, valueW);
      const rowH = Math.max(kl.length * (LEAD - 1), vl.length * LEAD) + 3;
      ensure(rowH);
      const top = y;
      kl.forEach((line, i) => {
        y = top - i * (LEAD - 1);
        text(line, MARGIN.left, SMALL + 0.5, fonts.bold, fonts.boldSet, "kv-label", GREY);
      });
      vl.forEach((line, i) => {
        y = top - i * LEAD;
        text(line, MARGIN.left + labelW + gap, BODY, fonts.regular, fonts.regularSet, "kv-value");
      });
      y = top - rowH;
    }
    y -= 4;
  };

  const drawTable = (header: string[], rows: string[][], widths: number[]) => {
    const colW = widths.map((w) => w * contentWidth);
    const pad = 4;
    const cellLines = (row: string[], font: PDFFont, size: number) => row.map((c, i) => lines(c || " ", font, size, colW[i]! - pad * 2));
    const drawRow = (row: string[], font: PDFFont, set: Set<number>, shade: boolean) => {
      const cl = cellLines(row, font, SMALL);
      const h = Math.max(...cl.map((c) => c.length)) * (SMALL + 3) + pad * 2;
      ensure(h);
      const top = y;
      if (shade) page.drawRectangle({ x: MARGIN.left, y: top - h, width: contentWidth, height: h, color: rgb(0.93, 0.95, 0.97) });
      page.drawRectangle({ x: MARGIN.left, y: top - h, width: contentWidth, height: h, borderColor: LINE, borderWidth: 0.5 });
      let x = MARGIN.left;
      cl.forEach((cell, c) => {
        cell.forEach((line, i) => {
          y = top - pad - i * (SMALL + 3);
          text(line, x + pad, SMALL, font, set, shade ? "table-head" : "table-cell");
        });
        x += colW[c]!;
        if (c < cl.length - 1) page.drawLine({ start: { x, y: top }, end: { x, y: top - h }, thickness: 0.5, color: LINE });
      });
      y = top - h;
    };
    // Header and first row together, so a table never starts with only its header.
    const first = rows[0] ? cellLines(rows[0], fonts.regular, SMALL) : [];
    ensure(SMALL + 3 + pad * 2 + (first.length ? Math.max(...first.map((c) => c.length)) * (SMALL + 3) + pad * 2 : 0));
    drawRow(header, fonts.bold, fonts.boldSet, true);
    for (const r of rows) {
      const probe = cellLines(r, fonts.regular, SMALL);
      const h = Math.max(...probe.map((c) => c.length)) * (SMALL + 3) + pad * 2;
      if (y - h < bottom) {
        newPage();
        drawRow(header, fonts.bold, fonts.boldSet, true);
      }
      drawRow(r, fonts.regular, fonts.regularSet, false);
    }
    y -= 8;
  };

  const drawParagraphs = (s: string, kind: string) => {
    for (const para of clean(s).split(/\n{2,}/)) {
      const ls = para.split("\n").flatMap((p) => wrap(p, fonts.regular, BODY, contentWidth));
      for (const line of ls) {
        ensure(LEAD);
        text(line, MARGIN.left, BODY, fonts.regular, fonts.regularSet, kind);
        y -= LEAD;
      }
      y -= 5;
    }
  };

  const SIG_GAP = 24;
  const sigRowHeight = (row: Array<{ name: string; detail: string | null }>) => {
    const boxW = (contentWidth - SIG_GAP) / 2;
    const measured = row.map((b) => ({ name: lines(b.name, fonts.regular, BODY, boxW), detail: b.detail ? lines(b.detail, fonts.regular, SMALL, boxW) : [] }));
    return LEAD + 46 + Math.max(...measured.map((m) => m.name.length * LEAD + m.detail.length * (SMALL + 3))) + LEAD + 10;
  };
  /** Total height of a signature section, so it can be kept on one page when it fits. */
  const signaturesHeight = (boxes: Array<{ name: string; detail: string | null }>) => {
    let h = 0;
    for (let i = 0; i < boxes.length; i += 2) h += sigRowHeight(boxes.slice(i, i + 2));
    return h;
  };

  const drawSignatures = (boxes: Array<{ role: string; name: string; detail: string | null }>, lang: DocumentSnapshot["language"]) => {
    const sigLabel = lang === "en" ? "(Signature)" : "(Υπογραφή)";
    const gap = 24;
    const boxW = (contentWidth - gap) / 2;
    for (let i = 0; i < boxes.length; i += 2) {
      const row = boxes.slice(i, i + 2);
      const measured = row.map((b) => ({ b, name: lines(b.name, fonts.regular, BODY, boxW), detail: b.detail ? lines(b.detail, fonts.regular, SMALL, boxW) : [] }));
      const h = sigRowHeight(row);
      ensure(h);
      const top = y;
      measured.forEach((m, c) => {
        const x = MARGIN.left + c * (boxW + gap);
        y = top;
        text(m.b.role, x, BODY, fonts.bold, fonts.boldSet, "signature-role");
        page.drawLine({ start: { x, y: top - LEAD - 40 }, end: { x: x + boxW, y: top - LEAD - 40 }, thickness: 0.8, color: INK });
        y = top - LEAD - 42;
        text(sigLabel, x, SMALL, fonts.regular, fonts.regularSet, "signature-label", GREY);
        y -= SMALL + 4;
        for (const n of m.name) {
          text(n, x, BODY, fonts.regular, fonts.regularSet, "signature-name");
          y -= LEAD;
        }
        for (const d of m.detail) {
          text(d, x, SMALL, fonts.regular, fonts.regularSet, "signature-detail", GREY);
          y -= SMALL + 3;
        }
      });
      y = top - h;
    }
  };

  const blocks = input.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    switch (b.t) {
      case "title": {
        const ls = lines(b.text, fonts.bold, 15, contentWidth);
        ensure(ls.length * 20 + 10);
        y -= 6;
        for (const line of ls) {
          text(line, MARGIN.left, 15, fonts.bold, fonts.boldSet, "title");
          y -= 20;
        }
        break;
      }
      case "subtitle": {
        const ls = lines(b.text, fonts.bold, 11.5, contentWidth);
        ensure(ls.length * 17);
        for (const line of ls) {
          text(line, MARGIN.left, 11.5, fonts.bold, fonts.boldSet, "subtitle");
          y -= 17;
        }
        y -= 4;
        break;
      }
      case "section": {
        // Keep the heading with what follows: reserve room for the heading and the next block's first row.
        // A signature section that fits on one page is never split: it moves whole, heading included.
        let j = i + 1;
        let leadH = 0;
        while (blocks[j]?.t === "para") {
          leadH += (blocks[j] as { text: string }).text.split("\n").reduce((n, p) => n + wrap(p, fonts.regular, BODY, contentWidth).length, 0) * LEAD + 5;
          j++;
        }
        const next = blocks[j];
        const sigsH = next && next.t === "signatures" ? leadH + signaturesHeight(next.boxes) : 0;
        ensure(sigsH && sigsH + 34 <= A4.height - MARGIN.top - bottom ? 34 + sigsH : 34 + 28);
        y -= 8;
        text(b.text, MARGIN.left, 11, fonts.bold, fonts.boldSet, "section");
        y -= 16;
        page.drawLine({ start: { x: MARGIN.left, y: y + 3 }, end: { x: MARGIN.left + contentWidth, y: y + 3 }, thickness: 0.6, color: LINE });
        y -= 4;
        break;
      }
      case "kv":
        drawKv(b.rows);
        break;
      case "table":
        drawTable(b.header, b.rows, b.widths);
        break;
      case "para":
        drawParagraphs(b.text, "paragraph");
        break;
      case "clauses":
        drawParagraphs(b.text, "clause");
        break;
      case "signatures":
        drawSignatures(b.boxes, input.snapshot.language);
        break;
    }
  }

  // Header, footer and numbering, now that the page count is known.
  const lang = input.snapshot.language;
  const ref = templateReference(input.snapshot);
  const footerLeft = [ref, input.snapshot.verificationCode ? `${lang === "en" ? "Verification" : "Επαλήθευση"}: ${input.snapshot.verificationCode}` : ""].filter(Boolean).join(" · ");
  const headerText = `${input.title} · ${input.snapshot.number}`;
  check(headerText, fonts.regularSet);
  check(footerLeft, fonts.regularSet);
  pages.forEach((p, i) => {
    const n = i + 1;
    const label = pageLabel(lang, n, pages.length);
    check(label, fonts.regularSet);
    p.drawText(headerText, { x: MARGIN.left, y: A4.height - 38, size: 8, font: regular, color: GREY });
    items.push({ page: n, x: MARGIN.left, y: A4.height - 38 - 2, width: regular.widthOfTextAtSize(headerText, 8), height: 10, text: headerText, kind: "header" });
    p.drawLine({ start: { x: MARGIN.left, y: 52 }, end: { x: A4.width - MARGIN.right, y: 52 }, thickness: 0.5, color: LINE });
    p.drawText(footerLeft, { x: MARGIN.left, y: 38, size: 7.5, font: regular, color: GREY });
    items.push({ page: n, x: MARGIN.left, y: 38 - 2, width: regular.widthOfTextAtSize(footerLeft, 7.5), height: 10, text: footerLeft, kind: "footer" });
    const w = regular.widthOfTextAtSize(label, 8.5);
    p.drawText(label, { x: A4.width - MARGIN.right - w, y: 38, size: 8.5, font: regular, color: GREY });
    items.push({ page: n, x: A4.width - MARGIN.right - w, y: 38 - 2, width: w, height: 10, text: label, kind: "page-number" });
  });

  if (unsupported.size > 0) {
    throw new PdfRenderError("UNSUPPORTED_CHARACTER", `Το έγγραφο περιέχει χαρακτήρες που δεν υποστηρίζει η γραμματοσειρά: ${[...unsupported].join(" ")}`);
  }

  const bytes = Buffer.from(await pdf.save({ useObjectStreams: true }));
  return { pdf: bytes, layout: { pageCount: pages.length, items, unsupportedCharacters: [...unsupported] } };
}
