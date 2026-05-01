// Thin wrapper around pdfjs-dist for rendering pages to canvases.
import * as pdfjsLib from "pdfjs-dist";
// Vite worker import — bundled, no CDN needed.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export const RENDER_SCALE = 1.5; // CSS pixels per PDF point

export async function loadPdf(file: File) {
  const data = await file.arrayBuffer();
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
  return { width: viewport.width, height: viewport.height };
}
