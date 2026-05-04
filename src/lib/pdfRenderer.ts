// Thin wrapper around pdfjs-dist for rendering pages and extracting text blocks.
import * as pdfjsLib from "pdfjs-dist";
import { OPS } from "pdfjs-dist";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export const RENDER_SCALE = 1.5; // CSS pixels per PDF point

export interface ExtractedBlock {
  id: string;
  // PDF point coordinates, top-left origin
  x: number;
  y: number;
  w: number;
  h: number;
  // baselineY is the PDF baseline in top-left point coordinates.
  baselineY: number;
  text: string;
  font: string;
  size: number;
  color: string;
}

export interface ExtractedPage {
  pageNumber: number;
  width: number;  // points
  height: number; // points
  blocks: ExtractedBlock[];
}

export async function loadPdf(data: ArrayBuffer) {
  // pdf-lib will need a fresh copy later; caller passes a copy.
  return pdfjsLib.getDocument({ data }).promise;
}

export async function renderPageToCanvas(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
  pageNumber: number,
  canvas: HTMLCanvasElement,
) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const ctx = canvas.getContext("2d")!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return {
    width: viewport.width,
    height: viewport.height,
    pdfWidth: viewport.width / RENDER_SCALE,
    pdfHeight: viewport.height / RENDER_SCALE,
  };
}

export async function extractPageBlocks(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
  pageNumber: number,
): Promise<ExtractedPage> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 }); // 1 = PDF points
  const content = await page.getTextContent();

  const blocks: ExtractedBlock[] = [];
  let i = 0;
  for (const item of content.items as Array<{
    str: string;
    transform: number[];
    width: number;
    height: number;
    fontName: string;
  }>) {
    const text = item.str;
    if (!text || !text.trim()) continue;

    // transform = [a, b, c, d, e, f]; for non-rotated text, font size = |d|.
    // Use the larger of |d| and hypot(a,b) to be safe with scaled fonts.
    const a = item.transform[0];
    const b = item.transform[1];
    const d = item.transform[3];
    const e = item.transform[4];
    const f = item.transform[5];
    const sizeFromD = Math.abs(d);
    const sizeFromAB = Math.hypot(a, b);
    const size = sizeFromD || sizeFromAB || 12;

    // pdf.js item.height is glyph-box height; item.width is run width in points.

    // Convert PDF coords (origin bottom-left, y at baseline) to top-left origin.
    // baselineY is the baseline in top-left point space.
    const baselineY = viewport.height - f;
    // Glyph-box top: ascent ≈ font size for most fonts. item.height (when
    // present) is the glyph-box height which already approximates ascent+descent.
    const ascent = size; // close to cap+ascent for typical fonts
    const xPt = e;
    const yPt = baselineY - ascent;
    const hPt = item.height || size;
    const wPt = item.width || text.length * size * 0.5;

    const styles = (content.styles as Record<string, { fontFamily: string }>) || {};
    const cssFamily = styles[item.fontName]?.fontFamily || "";
    const font = `${cssFamily} ${item.fontName || ""}`.trim();

    blocks.push({
      id: `p${pageNumber}_b${i++}`,
      x: xPt,
      y: yPt,
      w: wPt,
      h: hPt,
      baselineY,
      text,
      font,
      size,
      color: textColors[colorIndex++] || "#111827",
    });
  }

  return {
    pageNumber,
    width: viewport.width,
    height: viewport.height,
    blocks,
  };
}


async function extractTextColors(page: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdf>>["getPage"]>>): Promise<string[]> {
  const operatorList = await page.getOperatorList();
  const colors: string[] = [];
  let fill = "#111827";

  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i] || [];

    if (fn === OPS.setFillRGBColor) {
      fill = rgbToHex(args[0], args[1], args[2]);
    } else if (fn === OPS.setFillGray) {
      fill = rgbToHex(args[0], args[0], args[0]);
    } else if (fn === OPS.setFillCMYKColor) {
      fill = cmykToHex(args[0], args[1], args[2], args[3]);
    } else if (fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
      const text = extractOperatorText(args);
      if (text.trim()) colors.push(fill);
    }
  }

  return colors;
}

function extractOperatorText(args: unknown[]): string {
  const glyphs = Array.isArray(args[0]) ? args[0] : args;
  return glyphs
    .map((glyph) => {
      if (typeof glyph === "string") return glyph;
      if (typeof glyph === "number") return "";
      if (glyph && typeof glyph === "object" && "unicode" in glyph) {
        return String((glyph as { unicode?: string }).unicode || "");
      }
      return "";
    })
    .join("");
}

function rgbToHex(r = 0, g = 0, b = 0): string {
  const to255 = (value: number) => {
    const channel = value <= 1 ? value * 255 : value;
    return Math.max(0, Math.min(255, Math.round(channel)));
  };
  return `#${[to255(r), to255(g), to255(b)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function cmykToHex(c = 0, m = 0, y = 0, k = 0): string {
  return rgbToHex(1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k));
}
