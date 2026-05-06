import { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";
import { Download, ArrowLeft, Loader2, Plus, Minus } from "lucide-react";
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
  const activeTextRef = useRef<fabric.IText | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const buf = await file.arrayBuffer();
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
            preserveObjectStacking: true,
          });
          const fabricWrapper = overlay.parentElement as HTMLElement | null;
          if (fabricWrapper) {
            fabricWrapper.style.position = "absolute";
            fabricWrapper.style.top = "0";
            fabricWrapper.style.left = "0";
            fabricWrapper.style.width = `${width}px`;
            fabricWrapper.style.height = `${height}px`;
          }

          const pageData = await extractPageBlocks(pdf, i);
          pagesDataRef.current.push(pageData);

          for (const b of pageData.blocks) {
            const fv = fontVariant(b.font);
            const fontPx = b.size * RENDER_SCALE;
            const baselinePx = b.baselineY * RENDER_SCALE;
            const topPx = baselinePx - fontPx * 0.88;
            const leftPx = b.x * RENDER_SCALE;

            const tb = new fabric.IText(b.text, {
              left: leftPx,
              top: topPx,
              fontSize: fontPx,
              fontFamily: mapFont(b.font, fv.bold),
              fontWeight: fv.bold ? "700" : "400",
              fontStyle: fv.italic ? "italic" : "normal",
              fill: b.color || "#111827",
              // Always fully opaque so the edit text covers the original glyph
              // exactly — no need to erase the PDF underneath.
              opacity: 1,
              editable: true,
              hasControls: false,
              hasBorders: false,
              selectionColor: "rgba(59,130,246,0.15)",
              cursorColor: "#111827",
              lineHeight: 1,
              padding: 0,
              backgroundColor: "",
              objectCaching: false,
              hoverCursor: "text",
            });
            (tb as unknown as { _blockId: string })._blockId = b.id;
            (tb as unknown as { _origBold: boolean })._origBold = fv.bold;
            (tb as unknown as { _origItalic: boolean })._origItalic = fv.italic;

            tb.on("changed", () => {
              const text = tb.text || "";
              if (text !== b.text) editsRef.current[b.id] = text;
              else delete editsRef.current[b.id];
            });
            tb.on("editing:exited", () => {
              const text = tb.text || "";
              if (text !== b.text) editsRef.current[b.id] = text;
              else delete editsRef.current[b.id];
            });
            tb.on("selected", () => {
              activeTextRef.current = tb;
              refresh();
            });
            tb.on("deselected", () => {
              if (activeTextRef.current === tb) activeTextRef.current = null;
              refresh();
            });
            fc.add(tb);
          }

          // Single click on empty area => deselect, no edit, no new text.
          fc.on("mouse:down", (event) => {
            if (event.target) return;
            const active = fc.getActiveObject() as fabric.IText | null;
            if (active?.isEditing) active.exitEditing();
            fc.discardActiveObject();
            activeTextRef.current = null;
            fc.requestRenderAll();
            refresh();
          });

          // Double click on empty area => add new editable text there.
          fc.on("mouse:dblclick", (event) => {
            if (event.target) return;
            const pointer = fc.getPointer(event.e);
            const newText = new fabric.IText("New text", {
              left: pointer.x,
              top: pointer.y,
              fontSize: 18 * RENDER_SCALE,
              fontFamily: 'Inter, Helvetica, Arial, sans-serif',
              fill: "#111827",
              editable: true,
              hasControls: false,
              hasBorders: false,
              padding: 0,
              backgroundColor: "",
            });
            fc.add(newText);
            fc.setActiveObject(newText);
            newText.enterEditing();
            newText.selectAll();
            activeTextRef.current = newText;
            fc.requestRenderAll();
            refresh();
          });

          pageRefsRef.current.push({ pageNumber: i, fabricCanvas: fc });
        }

        const handleKey = (e: KeyboardEvent) => {
          if (e.key !== "Delete" && e.key !== "Backspace") return;
          for (const p of pageRefsRef.current) {
            const active = p.fabricCanvas.getActiveObject() as fabric.IText | null;
            if (!active || active.isEditing) continue;
            const blockId = (active as unknown as { _blockId?: string })._blockId;
            if (blockId) editsRef.current[blockId] = "";
            p.fabricCanvas.remove(active);
            p.fabricCanvas.discardActiveObject();
            activeTextRef.current = null;
            p.fabricCanvas.requestRenderAll();
            refresh();
            e.preventDefault();
            break;
          }
        };
        document.addEventListener("keydown", handleKey);
        (containerRef.current as unknown as { _cleanup?: () => void })._cleanup = () => {
          document.removeEventListener("keydown", handleKey);
        };
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

  const adjustFontSize = (delta: number) => {
    const t = activeTextRef.current;
    if (!t) return;
    const next = Math.max(6, (t.fontSize || 12) + delta);
    t.set({ fontSize: next });
    const blockId = (t as unknown as { _blockId?: string })._blockId;
    if (blockId) editsRef.current[blockId] = t.text || "";
    t.canvas?.requestRenderAll();
    refresh();
  };

  const handleDownload = async () => {
    if (!originalBytesRef.current) {
      toast.error("PDF not ready");
      return;
    }
    try {
      setSaving(true);
      for (const p of pageRefsRef.current) {
        const active = p.fabricCanvas.getActiveObject();
        if (active && (active as fabric.IText).isEditing) {
          (active as fabric.IText).exitEditing();
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

  const active = activeTextRef.current;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> New file
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={!active}
              onClick={() => adjustFontSize(-2)}
              title="Decrease font size"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-10 text-center text-sm tabular-nums text-muted-foreground">
              {active ? Math.round((active.fontSize || 0) / RENDER_SCALE) : "–"}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={!active}
              onClick={() => adjustFontSize(2)}
              title="Increase font size"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
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

function mapFont(name: string, bold = false): string {
  const raw = (name || "").trim();
  const cssFamily = raw.split(/\s+/)[0]?.replace(/[",]/g, "") || "";
  const n = normalizeFont(name);
  const fallback = MONO_HINTS.some((m) => n.includes(m))
    ? '"JetBrains Mono", "Courier New", Courier, monospace'
    : SERIF_HINTS.some((m) => n.includes(m))
      ? '"Source Serif 4", "Times New Roman", Times, serif'
      : 'Inter, Helvetica, Arial, sans-serif';
  // For bold variants, skip the embedded css family because it is often a
  // single-weight subset that cannot render bold — fall back to a system
  // family that DOES have a bold weight.
  if (bold) return fallback;
  if (cssFamily && !/^g_d\d+/i.test(cssFamily)) {
    return `"${cssFamily}", ${fallback}`;
  }
  return fallback;
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
