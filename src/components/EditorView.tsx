import { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";
import { Download, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { loadPdf, renderPageToCanvas, RENDER_SCALE } from "@/lib/pdfRenderer";
import { extractPdf, savePdf, type ExtractResponse, type Edit } from "@/lib/api";

interface Props {
  file: File;
  onBack: () => void;
}

interface PageRefs {
  pageNumber: number;
  fabricCanvas: fabric.Canvas;
  edits: Map<string, Edit>;
}

export function EditorView({ file, onBack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefsRef = useRef<PageRefs[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extracted, setExtracted] = useState<ExtractResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const pdf = await loadPdf(file);

        // Try to extract text metadata from backend. If the backend isn't
        // configured yet, fall back to render-only mode (no editable overlays).
        let extract: ExtractResponse | null = null;
        try {
          extract = await extractPdf(file);
          if (!cancelled) setExtracted(extract);
        } catch (e) {
          console.warn("Extract API unavailable — rendering preview only.", e);
          toast.warning("Backend not connected — editing disabled. Set VITE_API_URL.");
        }

        if (!containerRef.current || cancelled) return;
        containerRef.current.innerHTML = "";
        pageRefsRef.current = [];

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

          // Fabric overlay sized to match
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

          const edits = new Map<string, Edit>();

          // If backend gave us blocks, render editable Textbox per block.
          const pageData = extract?.pages[i - 1];
          if (pageData) {
            for (const b of pageData.blocks) {
              const tb = new fabric.Textbox(b.text, {
                left: b.x * RENDER_SCALE,
                top: b.y * RENDER_SCALE,
                width: Math.max(b.w * RENDER_SCALE, 20),
                fontSize: b.size * RENDER_SCALE,
                fontFamily: mapFont(b.font),
                fill: b.color || "#111827",
                editable: true,
                hasControls: false,
                hasBorders: false,
                backgroundColor: "rgba(255,255,255,0.001)",
                lockMovementX: true,
                lockMovementY: true,
              });
              (tb as unknown as { _blockId: string })._blockId = b.id;

              // Mask the original glyphs when entering edit mode so the
              // underlying PDF text doesn't show through the new text.
              tb.on("editing:entered", () => {
                tb.set("backgroundColor", "#ffffff");
                fc.requestRenderAll();
              });
              tb.on("changed", () => {
                edits.set(b.id, { id: b.id, page: i, text: tb.text || "" });
              });
              fc.add(tb);
            }
          }

          pageRefsRef.current.push({ pageNumber: i, fabricCanvas: fc, edits });
        }

        // Click outside any active textbox -> exit edit mode (auto lock).
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
    if (!extracted) {
      toast.error("Backend not connected — cannot save. Set VITE_API_URL.");
      return;
    }
    try {
      setSaving(true);
      const allEdits: Edit[] = [];
      for (const p of pageRefsRef.current) allEdits.push(...p.edits.values());
      const blob = await savePdf(extracted.fileId, allEdits);
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

// Map PDF font name hints to web-safe equivalents.
function mapFont(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("times") || n.includes("serif") || n.includes("roman"))
    return "Times New Roman, Times, serif";
  if (n.includes("courier") || n.includes("mono"))
    return "Courier New, Courier, monospace";
  return "Helvetica, Arial, sans-serif";
}
