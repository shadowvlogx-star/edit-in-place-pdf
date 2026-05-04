import { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";
import { Download, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  loadPdf,
  renderPageToCanvas,
  extractPageBlocks,
  RENDER_SCALE,
  type ExtractedPage,
} from "@/lib/pdfRenderer";
import { buildEditedPdf, type EditMap } from "@/lib/pdfExport";

interface Props {
  file: File;
  onBack: () => void;
}

interface PageRef {
  pageNumber: number;
  fabricCanvas: fabric.Canvas;
}

export function EditorView({ file, onBack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefsRef = useRef<PageRef[]>([]);
  const editsRef = useRef<EditMap>({});
  const pagesDataRef = useRef<ExtractedPage[]>([]);
  const originalBytesRef = useRef<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const buf = await file.arrayBuffer();
        // Keep a pristine copy for pdf-lib (pdf.js may detach buffers).
        originalBytesRef.current = buf.slice(0);
        const pdf = await loadPdf(buf);

        if (!containerRef.current || cancelled) return;
        containerRef.current.innerHTML = "";
        pageRefsRef.current = [];
        pagesDataRef.current = [];
        editsRef.current = {};

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;

          const wrap = document.createElement("div");
          wrap.className =
            "relative mx-auto mb-6 rounded-lg overflow-hidden shadow-soft bg-surface";
          containerRef.current.appendChild(wrap);

          const pdfCanvas = document.createElement("canvas");
          pdfCanvas.style.display = "block";
          wrap.appendChild(pdfCanvas);

          const { width, height } = await renderPageToCanvas(pdf, i, pdfCanvas);

          const overlay = document.createElement("canvas");
          overlay.width = width;
          overlay.height = height;
          overlay.style.position = "absolute";
          overlay.style.inset = "0";
          wrap.appendChild(overlay);

          const fc = new fabric.Canvas(overlay, {
            width,
            height,
            backgroundColor: "transparent",
            selection: false,
          });

          const pageData = await extractPageBlocks(pdf, i);
          pagesDataRef.current.push(pageData);

          const pdfCtx = pdfCanvas.getContext("2d")!;
          // Snapshot original PDF pixels so we can restore a region after edits
          // are reverted (e.g. user types nothing new).
          const originalImage = pdfCtx.getImageData(0, 0, width, height);

          for (const b of pageData.blocks) {
            const fv = fontVariant(b.font);
            const fontPx = b.size * RENDER_SCALE;
            // baselineY is in top-left point coords. For ascent ≈ fontSize, the
            // glyph-box top is baseline - fontSize. Fabric draws the first line
            // with baseline at top + fontSize (lineHeight 1, no internal lead),
            // so set top = baselinePx - fontPx.
            const baselinePx = b.baselineY * RENDER_SCALE;
            const topPx = baselinePx - fontPx * 0.88;
            const leftPx = b.x * RENDER_SCALE;
            const boxW = Math.max(b.w * RENDER_SCALE + 4, 12);
            const boxH = fontPx * 1.25;

            const tb = new fabric.IText(b.text, {
              left: leftPx,
              top: topPx,
              fontSize: fontPx,
              fontFamily: mapFont(b.font),
              fontWeight: fv.bold ? "700" : "400",
              fontStyle: fv.italic ? "italic" : "normal",
              fill: b.color || "#111827",
              // Invisible until the user interacts — preserves original
              // glyphs (color, RTL Arabic shaping, line boxes) underneath.
              opacity: 0,
              editable: true,
              hasControls: false,
              hasBorders: false,
              lineHeight: 1,
              lockMovementX: true,
              lockMovementY: true,
              padding: 0,
            });
            (tb as unknown as { _blockId: string })._blockId = b.id;

            const eraseUnder = () => {
              paintAverageBackground(
                pdfCtx,
                originalImage,
                Math.max(0, leftPx - 2),
                Math.max(0, topPx - 2),
                boxW + 4,
                boxH + 4,
              );
            };
            const restoreUnder = () => {
              pdfCtx.putImageData(
                originalImage,
                0, 0,
                Math.max(0, leftPx - 2),
                Math.max(0, topPx - 2),
                boxW + 4,
                boxH + 4,
              );
            };

            tb.on("mousedown", () => {
              eraseUnder();
              tb.set({ opacity: 1 });
              fc.requestRenderAll();
            });
            tb.on("editing:entered", () => {
              eraseUnder();
              tb.set({ opacity: 1 });
              fc.requestRenderAll();
            });
            tb.on("editing:exited", () => {
              const text = tb.text || "";
              if (text !== b.text) {
                editsRef.current[b.id] = text;
                // Keep edit visible; original stays erased.
                tb.set({ opacity: 1 });
              } else {
                delete editsRef.current[b.id];
                restoreUnder();
                tb.set({ opacity: 0 });
              }
              fc.requestRenderAll();
            });
            tb.on("changed", () => {
              const text = tb.text || "";
              if (text !== b.text) editsRef.current[b.id] = text;
              else delete editsRef.current[b.id];
            });
            fc.add(tb);
          }

          pageRefsRef.current.push({ pageNumber: i, fabricCanvas: fc });
        }

        const handleDocClick = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          const insideOverlay = target.closest("canvas.upper-canvas");
          if (insideOverlay) return;
          for (const p of pageRefsRef.current) {
            const active = p.fabricCanvas.getActiveObject();
            if (active && (active as fabric.Textbox).isEditing) {
              (active as fabric.Textbox).exitEditing();
            }
            p.fabricCanvas.discardActiveObject();
            p.fabricCanvas.requestRenderAll();
          }
        };
        document.addEventListener("mousedown", handleDocClick);
        (containerRef.current as unknown as { _cleanup?: () => void })._cleanup = () =>
          document.removeEventListener("mousedown", handleDocClick);
      } catch (err) {
        console.error(err);
        toast.error("Failed to load PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      const c = containerRef.current as unknown as { _cleanup?: () => void } | null;
      c?._cleanup?.();
      for (const p of pageRefsRef.current) p.fabricCanvas.dispose();
      pageRefsRef.current = [];
    };
  }, [file]);

  const handleDownload = async () => {
    if (!originalBytesRef.current) {
      toast.error("PDF not ready");
      return;
    }
    try {
      setSaving(true);
      // Make sure any in-progress edits are committed.
      for (const p of pageRefsRef.current) {
        const active = p.fabricCanvas.getActiveObject();
        if (active && (active as fabric.Textbox).isEditing) {
          (active as fabric.Textbox).exitEditing();
        }
      }
      const blob = await buildEditedPdf(
        originalBytesRef.current.slice(0),
        pagesDataRef.current,
        editsRef.current,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, "") + "-edited.pdf";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded");
    } catch (e) {
      console.error(e);
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> New file
          </Button>
          <div className="text-sm text-muted-foreground truncate max-w-[40%]">{file.name}</div>
          <Button onClick={handleDownload} disabled={saving || loading}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download
          </Button>
        </div>
      </header>

      {loading && (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading PDF…
        </div>
      )}

      <div ref={containerRef} className="mx-auto max-w-5xl px-6 py-8" />
    </div>
  );
}

function normalizeFont(name: string): string {
  return (name || "").replace(/^[A-Z]{6}\+/g, "").toLowerCase();
}

const SERIF_HINTS = [
  "times", "serif", "roman", "georgia", "garamond", "cambria", "minion",
  "palatino", "bookman", "caslon", "baskerville", "didot", "merriweather",
  "source serif", "noto serif", "pt serif", "liberation serif", "dejavu serif",
  "cmr", "computer modern", "charter", "century", "lora", "playfair",
];
const MONO_HINTS = [
  "courier", "mono", "consolas", "menlo", "monaco", "inconsolata",
  "source code", "fira code", "fira mono", "jetbrains", "ibm plex mono",
  "liberation mono", "dejavu mono", "cmtt", "andale", "lucida console",
];

function mapFont(name: string): string {
  const n = normalizeFont(name);
  if (MONO_HINTS.some((m) => n.includes(m)))
    return '"JetBrains Mono", "Courier New", Courier, monospace';
  if (SERIF_HINTS.some((m) => n.includes(m)))
    return '"Source Serif 4", "Times New Roman", Times, serif';
  return 'Inter, Helvetica, Arial, sans-serif';
}

function fontVariant(name: string): { bold: boolean; italic: boolean } {
  const n = normalizeFont(name);
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


function paintAverageBackground(
  ctx: CanvasRenderingContext2D,
  image: ImageData,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(image.width, Math.ceil(x + w));
  const y1 = Math.min(image.height, Math.ceil(y + h));
  const data = image.data;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  // Sample the border around the text box so masks keep colored page areas
  // instead of forcing every edit area to white.
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const nearEdge = yy - y0 < 2 || y1 - yy <= 2 || xx - x0 < 2 || x1 - xx <= 2;
      if (!nearEdge) continue;
      const idx = (yy * image.width + xx) * 4;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
      count++;
    }
  }

  ctx.fillStyle = count
    ? `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`
    : "#ffffff";
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}
