import { useEffect, useMemo, useRef, useState } from "react";
import * as fabric from "fabric";
import {
  Download,
  ArrowLeft,
  Loader2,
  Plus,
  Minus,
  Trash2,
  ZoomIn,
  ZoomOut,
  FileText,
  MousePointer2,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  ArrowUp,
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronsUp,
  ChevronsDown,
  Copy,
  Undo2,
  Redo2,
  RotateCw,
  Search,
  Save,
} from "lucide-react";

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
  wrap: HTMLDivElement;
  width: number;
  height: number;
}

export function EditorView({ file, onBack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbsRef = useRef<HTMLDivElement>(null);
  const pageRefsRef = useRef<PageRef[]>([]);
  const editsRef = useRef<EditMap>({});
  const pagesDataRef = useRef<ExtractedPage[]>([]);
  const originalBytesRef = useRef<ArrayBuffer | null>(null);
  const activeTextRef = useRef<fabric.IText | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [activePage, setActivePage] = useState(1);
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
        if (thumbsRef.current) thumbsRef.current.innerHTML = "";
        pageRefsRef.current = [];
        pagesDataRef.current = [];
        editsRef.current = {};
        setPageCount(pdf.numPages);

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;

          const wrap = document.createElement("div");
          wrap.className =
            "relative mx-auto mb-8 rounded-md overflow-hidden bg-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/5";
          wrap.dataset.page = String(i);
          containerRef.current.appendChild(wrap);

          const pdfCanvas = document.createElement("canvas");
          pdfCanvas.style.display = "block";
          wrap.appendChild(pdfCanvas);

          const { width, height } = await renderPageToCanvas(pdf, i, pdfCanvas);
          const pdfCtx = pdfCanvas.getContext("2d")!;

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

            // Erase original glyphs on underlying PDF canvas to prevent duplicate text overlap.
            const eraseX = Math.max(0, leftPx - 1);
            const eraseY = Math.max(0, baselinePx - fontPx * 1.05);
            const eraseW = Math.min(width - eraseX, b.w * RENDER_SCALE + 2);
            const eraseH = Math.min(height - eraseY, fontPx * 1.35);
            pdfCtx.clearRect(eraseX, eraseY, eraseW, eraseH);

            const tb = new fabric.IText(b.text, {
              left: leftPx,
              top: topPx,
              fontSize: fontPx,
              fontFamily: mapFont(b.font, fv.bold),
              fontWeight: fv.bold ? "700" : "400",
              fontStyle: fv.italic ? "italic" : "normal",
              fill: b.color || "#111827",
              opacity: 1,
              editable: true,
              hasControls: false,
              hasBorders: false,
              selectionColor: "rgba(0,0,0,0)",
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

          fc.on("mouse:down", (event) => {
            if (event.target) return;
            const active = fc.getActiveObject() as fabric.IText | null;
            if (active?.isEditing) active.exitEditing();
            fc.discardActiveObject();
            activeTextRef.current = null;
            fc.requestRenderAll();
            refresh();
          });

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

          pageRefsRef.current.push({ pageNumber: i, fabricCanvas: fc, wrap, width, height });

          // Build thumbnail
          if (thumbsRef.current) {
            const tWrap = document.createElement("button");
            tWrap.type = "button";
            tWrap.className =
              "group block w-full rounded-md overflow-hidden border border-white/10 bg-white/5 hover:border-blue-400/50 transition text-left";
            tWrap.dataset.thumb = String(i);
            const tCanvas = document.createElement("canvas");
            tCanvas.style.display = "block";
            tCanvas.style.width = "100%";
            tWrap.appendChild(tCanvas);
            const label = document.createElement("div");
            label.className = "px-2 py-1 text-[10px] text-white/50 group-hover:text-white/80";
            label.textContent = `Page ${i}`;
            tWrap.appendChild(label);
            thumbsRef.current.appendChild(tWrap);

            // Render small
            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale: 0.25 });
            tCanvas.width = vp.width;
            tCanvas.height = vp.height;
            const tctx = tCanvas.getContext("2d")!;
            await page.render({ canvasContext: tctx, viewport: vp, canvas: tCanvas }).promise;

            tWrap.addEventListener("click", () => {
              wrap.scrollIntoView({ behavior: "smooth", block: "start" });
              setActivePage(i);
            });
          }
        }

        // Track active page on scroll
        const scrollEl = containerRef.current?.parentElement;
        const onScroll = () => {
          if (!scrollEl) return;
          const top = scrollEl.scrollTop;
          let best = 1;
          let bestDist = Infinity;
          for (const p of pageRefsRef.current) {
            const d = Math.abs(p.wrap.offsetTop - top);
            if (d < bestDist) {
              bestDist = d;
              best = p.pageNumber;
            }
          }
          setActivePage(best);
        };
        scrollEl?.addEventListener("scroll", onScroll);

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
          scrollEl?.removeEventListener("scroll", onScroll);
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

  // Apply zoom via CSS transform on each page wrap
  useEffect(() => {
    for (const p of pageRefsRef.current) {
      p.wrap.style.transform = `scale(${zoom})`;
      p.wrap.style.transformOrigin = "top center";
      p.wrap.style.marginBottom = `${32 * zoom}px`;
      p.wrap.style.width = `${p.width}px`;
      p.wrap.style.height = `${p.height}px`;
    }
  }, [zoom]);

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

  const deleteActive = () => {
    const t = activeTextRef.current;
    if (!t || t.isEditing) return;
    const blockId = (t as unknown as { _blockId?: string })._blockId;
    if (blockId) editsRef.current[blockId] = "";
    const fc = t.canvas;
    fc?.remove(t);
    fc?.discardActiveObject();
    activeTextRef.current = null;
    fc?.requestRenderAll();
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
    <div className="h-screen flex flex-col bg-[#0A0B0F] text-white overflow-hidden">
      {/* Top toolbar */}
      <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#0E1015]/95 backdrop-blur px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-white/70 hover:text-white hover:bg-white/10"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> New file
          </Button>
          <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-white/10">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-indigo-600">
              <FileText className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-xs font-medium truncate max-w-[200px]" title={file.name}>
              {file.name}
            </span>
          </div>
        </div>

        {/* Center toolbar */}
        <div className="flex items-center gap-1.5">
          <ToolGroup>
            <IconBtn
              disabled={!active}
              onClick={() => adjustFontSize(-2)}
              title="Decrease font size"
            >
              <Minus className="h-4 w-4" />
            </IconBtn>
            <span className="w-9 text-center text-xs tabular-nums text-white/70">
              {active ? Math.round((active.fontSize || 0) / RENDER_SCALE) : "–"}
            </span>
            <IconBtn
              disabled={!active}
              onClick={() => adjustFontSize(2)}
              title="Increase font size"
            >
              <Plus className="h-4 w-4" />
            </IconBtn>
          </ToolGroup>

          <ToolGroup>
            <IconBtn onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))} title="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </IconBtn>
            <span className="w-12 text-center text-xs tabular-nums text-white/70">
              {Math.round(zoom * 100)}%
            </span>
            <IconBtn onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.1).toFixed(2)))} title="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </IconBtn>
          </ToolGroup>

          <ToolGroup>
            <IconBtn disabled={!active} onClick={deleteActive} title="Delete selected">
              <Trash2 className="h-4 w-4" />
            </IconBtn>
          </ToolGroup>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-white/50">
            <MousePointer2 className="h-3 w-3" />
            Click to edit · Double-click empty to add
          </span>
          <Button
            onClick={handleDownload}
            disabled={saving || loading}
            className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white shadow-[0_0_30px_-5px_rgba(59,130,246,0.6)]"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download
          </Button>
        </div>
      </header>

      {/* Workspace */}
      <div className="flex flex-1 min-h-0">
        {/* Left thumbnails sidebar */}
        <aside className="hidden md:flex flex-col w-48 shrink-0 border-r border-white/10 bg-[#0C0D12]">
          <div className="px-3 py-2.5 text-[11px] uppercase tracking-wider text-white/40 border-b border-white/5 flex items-center justify-between">
            <span>Pages</span>
            <span className="text-white/30">{pageCount}</span>
          </div>
          <div ref={thumbsRef} className="flex-1 overflow-y-auto p-2 space-y-2" />
        </aside>

        {/* Center canvas area */}
        <main className="flex-1 overflow-auto bg-[#0A0B0F]">
          {loading && (
            <div className="flex items-center justify-center py-24 text-white/60">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading PDF…
            </div>
          )}
          <div className="px-6 py-8 flex flex-col items-center">
            <div ref={containerRef} />
          </div>
        </main>

        {/* Right indicator */}
        <aside className="hidden lg:flex flex-col w-12 shrink-0 border-l border-white/10 bg-[#0C0D12] items-center pt-3">
          <div className="text-[10px] text-white/40">{activePage}/{pageCount || "–"}</div>
        </aside>
      </div>
    </div>
  );
}

function ToolGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] px-1 py-0.5">
      {children}
    </div>
  );
}

function IconBtn({
  children,
  disabled,
  onClick,
  title,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition"
    >
      {children}
    </button>
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
