// Client-side PDF export: redact original text with white boxes and write
// edited text on top using pdf-lib's standard fonts.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { ExtractedBlock, ExtractedPage } from "./pdfRenderer";

export interface EditMap {
  // key: block id -> new text
  [id: string]: string;
}

type FontKind = "helv" | "times" | "courier";

// Known serif / mono families to map onto the closest Standard 14 face.
const SERIF_FAMILIES = [
  "times", "serif", "roman", "georgia", "garamond", "cambria", "minion",
  "palatino", "bookman", "caslon", "baskerville", "didot", "merriweather",
  "source serif", "noto serif", "pt serif", "liberation serif", "dejavu serif",
  "cmr", "computer modern", "charter", "century", "lora", "playfair",
];
const MONO_FAMILIES = [
  "courier", "mono", "consolas", "menlo", "monaco", "inconsolata",
  "source code", "fira code", "fira mono", "jetbrains", "ibm plex mono",
  "liberation mono", "dejavu mono", "cmtt", "andale", "lucida console",
];

function normalize(s: string): string {
  // Strip the random PDF subset prefix like "BCDEEE+" and lower-case.
  return (s || "").replace(/^[A-Z]{6}\+/g, "").toLowerCase();
}

function pickFontKind(fontHint: string): FontKind {
  const n = normalize(fontHint);
  if (MONO_FAMILIES.some((m) => n.includes(m))) return "courier";
  if (SERIF_FAMILIES.some((m) => n.includes(m))) return "times";
  return "helv";
}

function variant(fontHint: string): { bold: boolean; italic: boolean } {
  const n = normalize(fontHint);
  return {
    bold:
      /\bbold\b/.test(n) ||
      /-bold/.test(n) ||
      /,bold/.test(n) ||
      n.includes("black") ||
      n.includes("heavy") ||
      n.includes("semibold") ||
      n.includes("demibold") ||
      n.includes("extrabold") ||
      /\bbd\b/.test(n) ||
      / w[6-9]/.test(n),
    italic:
      n.includes("italic") ||
      n.includes("oblique") ||
      /-it\b/.test(n) ||
      /\bit\b/.test(n),
  };
}

function cssHexToRgb(color: string) {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color || "");
  if (!hex) return rgb(0.07, 0.09, 0.15);
  const value = hex[1];
  return rgb(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  );
}

async function getFont(
  doc: PDFDocument,
  cache: Map<string, PDFFont>,
  hint: string,
): Promise<PDFFont> {
  const kind = pickFontKind(hint);
  const v = variant(hint);
  const key = `${kind}|${v.bold}|${v.italic}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let std: StandardFonts;
  if (kind === "times") {
    std = v.bold && v.italic
      ? StandardFonts.TimesRomanBoldItalic
      : v.bold
      ? StandardFonts.TimesRomanBold
      : v.italic
      ? StandardFonts.TimesRomanItalic
      : StandardFonts.TimesRoman;
  } else if (kind === "courier") {
    std = v.bold && v.italic
      ? StandardFonts.CourierBoldOblique
      : v.bold
      ? StandardFonts.CourierBold
      : v.italic
      ? StandardFonts.CourierOblique
      : StandardFonts.Courier;
  } else {
    std = v.bold && v.italic
      ? StandardFonts.HelveticaBoldOblique
      : v.bold
      ? StandardFonts.HelveticaBold
      : v.italic
      ? StandardFonts.HelveticaOblique
      : StandardFonts.Helvetica;
  }
  const f = await doc.embedFont(std);
  cache.set(key, f);
  return f;
}

export async function buildEditedPdf(
  originalBytes: ArrayBuffer,
  pages: ExtractedPage[],
  edits: EditMap,
): Promise<Blob> {
  const doc = await PDFDocument.load(originalBytes);
  const fontCache = new Map<string, PDFFont>();
  const docPages = doc.getPages();

  for (const pageData of pages) {
    const page = docPages[pageData.pageNumber - 1];
    if (!page) continue;
    const { height: pageHeightPt } = page.getSize();

    for (const block of pageData.blocks) {
      const newText = edits[block.id];
      if (newText === undefined || newText === block.text) continue;

      // 1) Cover the original text area with a white rectangle.
      // Block coords are top-left origin in PDF points; pdf-lib uses bottom-left.
      const padX = 0.5;
      const padY = 1;
      const rectX = block.x - padX;
      const rectY = pageHeightPt - block.y - block.h - padY;
      const rectW = block.w + padX * 2;
      const rectH = block.h + padY * 2;
      page.drawRectangle({
        x: rectX,
        y: rectY,
        width: rectW,
        height: rectH,
        color: rgb(1, 1, 1),
      });

      // 2) Draw the new text in the closest standard font.
      const font = await getFont(doc, fontCache, block.font);
      // Auto-shrink to fit width if needed.
      let size = block.size;
      let textWidth = font.widthOfTextAtSize(newText, size);
      const maxWidth = block.w * 1.05;
      if (newText.length > 0 && textWidth > maxWidth && maxWidth > 0) {
        size = Math.max(4, size * (maxWidth / textWidth));
        textWidth = font.widthOfTextAtSize(newText, size);
      }
      // Baseline position: top-left of block -> baseline ≈ top + ascent
      const ascent = font.heightAtSize(size, { descender: false });
      const textX = block.x;
      const textY = pageHeightPt - block.baselineY;

      page.drawText(newText, {
        x: textX,
        y: textY,
        size,
        font,
        color: cssHexToRgb(block.color),
      });
    }
  }

  const out = await doc.save();
  return new Blob([out as BlobPart], { type: "application/pdf" });
}
