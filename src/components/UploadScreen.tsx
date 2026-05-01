import { useCallback, useRef, useState } from "react";
import { FileUp, FileText } from "lucide-react";
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
    <main
      className="min-h-screen flex items-center justify-center px-6"
      style={{ backgroundImage: "var(--gradient-hero)" }}
    >
      <div className="w-full max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground mb-6">
          <FileText className="h-3.5 w-3.5" />
          PDF Editor
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-3">
          Edit your PDF in place
        </h1>
        <p className="text-muted-foreground mb-10">
          Upload, click any text to edit, download. No accounts. No fuss.
        </p>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
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
            "group w-full rounded-2xl border-2 border-dashed bg-surface p-12 transition-smooth",
            "hover:border-brand hover:shadow-elevated",
            dragging ? "border-brand bg-brand/5 shadow-elevated" : "border-border",
          )}
          style={{ boxShadow: dragging ? "var(--shadow-elevated)" : "var(--shadow-soft)" }}
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand">
            <FileUp className="h-7 w-7" />
          </div>
          <p className="text-base font-medium text-foreground">Drag & drop your PDF here</p>
          <p className="mt-1 text-sm text-muted-foreground">or click to browse — Upload Only PDF</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => handle(e.target.files?.[0])}
          />
        </button>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </div>
    </main>
  );
}
