import { useCallback, useRef, useState } from "react";
import { FileUp, FileText, Sparkles, Type, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onFile: (file: File) => void;
}

export function UploadScreen({ onFile }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (file?: File | null) => {
      if (!file) return;
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setError("Upload Only PDF");
        return;
      }
      setError(null);
      onFile(file);
    },
    [onFile],
  );

  return (
    <main className="min-h-screen bg-[#0A0B0F] text-white relative overflow-hidden">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 500px at 50% -10%, rgba(59,130,246,0.18), transparent 60%), radial-gradient(700px 400px at 80% 100%, rgba(99,102,241,0.10), transparent 60%)",
        }}
      />

      {/* Top brand bar */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-[0_0_20px_rgba(59,130,246,0.5)]">
            <FileText className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight">
            PDFEdit <span className="text-blue-400">Pro</span>
          </span>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 backdrop-blur">
          <Sparkles className="h-3 w-3 text-blue-400" /> Premium PDF Editor
        </span>
      </header>

      <section className="relative z-10 mx-auto max-w-3xl px-6 pt-10 pb-20 text-center">
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
          Edit PDFs like a design file
        </h1>
        <p className="mt-5 text-base md:text-lg text-white/60 max-w-2xl mx-auto">
          Click any word, number, or field and edit it directly while preserving the exact font,
          size, color, and layout of the original document.
        </p>

        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handle(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "group mt-12 mx-auto w-full rounded-2xl border border-dashed p-10 cursor-pointer transition-all backdrop-blur",
            "bg-white/[0.03] hover:bg-white/[0.05]",
            dragging
              ? "border-blue-400/70 shadow-[0_0_60px_-10px_rgba(59,130,246,0.6)]"
              : "border-white/15 hover:border-blue-400/50",
          )}
        >
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-500/10 border border-blue-400/30">
            <FileUp className="h-7 w-7 text-blue-400" />
          </div>
          <p className="text-lg font-medium">Drop your PDF here</p>
          <p className="mt-1 text-sm text-white/50">or click to browse — PDF files only</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => handle(e.target.files?.[0])}
          />
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          {[
            {
              icon: <Type className="h-4 w-4 text-blue-400" />,
              title: "True edit-in-place",
              desc: "Click any text and type. No reflow, no layout shifts.",
            },
            {
              icon: <Sparkles className="h-4 w-4 text-blue-400" />,
              title: "Font-accurate",
              desc: "Preserves original fonts, sizes, weights, and colors.",
            },
            {
              icon: <Download className="h-4 w-4 text-blue-400" />,
              title: "Instant download",
              desc: "Export a clean PDF in one click. Nothing leaves your device.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur transition hover:border-white/20 hover:bg-white/[0.05]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-400/20">
                {f.icon}
              </div>
              <p className="mt-3 text-sm font-medium">{f.title}</p>
              <p className="mt-1 text-xs text-white/50 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
