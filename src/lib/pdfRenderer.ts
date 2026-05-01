// Thin wrapper around pdfjs-dist for rendering pages and extracting text blocks.
import * as pdfjsLib from "pdfjs-dist";
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

    // transform = [a, b, c, d, e, f]; font size ~ sqrt(a*a + b*b) for non-rotated
    const a = item.transform[0];
    const d = item.transform[3];
    const e = item.transform[4];
    const f = item.transform[5];
    const size = Math.hypot(a, item.transform[1]) || Math.abs(d) || 12;

    // Convert PDF coords (origin bottom-left) to top-left origin
    const xPt = e;
    const yPt = viewport.height - f - size * 0.8; // approx baseline -> top
    const wPt = item.width || text.length * size * 0.5;
    const hPt = item.height || size * 1.2;

    const styles = (content.styles as Record<string, { fontFamily: string }>) || {};
    const cssFamily = styles[item.fontName]?.fontFamily || "";
    // Combine the css family hint with the raw PostScript name. Raw names like
    // "BCDEEE+Calibri-Bold" or "TimesNewRomanPS-BoldItalicMT" carry weight/style
    // info that the css family alone usually drops.
    const font = `${cssFamily} ${item.fontName || ""}`.trim();

    blocks.push({
      id: `p${pageNumber}_b${i++}`,
      x: xPt,
      y: yPt,
      w: wPt,
      h: hPt,
      text,
      font,
      size,
      color: "#111827",
    });
  }

  return {
    pageNumber,
    width: viewport.width,
    height: viewport.height,
    blocks,
  };
}
