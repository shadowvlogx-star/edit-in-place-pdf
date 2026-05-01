// API client for the external Python (Flask + PyMuPDF) backend.
// Set VITE_API_URL in your .env to point at your Flask server.
//
// Expected backend endpoints:
//   POST /extract  -> multipart/form-data { file: PDF }
//                     returns: { pages: [{ width, height, blocks: [{ id, x, y, w, h, text, font, size, color }] }] }
//   POST /save     -> application/json    { fileId, edits: [{ id, page, text }] }
//                     returns: application/pdf (binary)

export const API_URL = import.meta.env.VITE_API_URL || "";

export interface TextBlock {
  id: string;
  x: number;        // PDF user-space coords (origin top-left, in points)
  y: number;
  w: number;
  h: number;
  text: string;
  font: string;     // PDF font name hint (e.g. "Helvetica", "Times-Roman")
  size: number;     // points
  color: string;    // CSS color, e.g. "#111827"
}

export interface ExtractedPage {
  width: number;    // points
  height: number;
  blocks: TextBlock[];
}

export interface ExtractResponse {
  fileId: string;
  pages: ExtractedPage[];
}

export interface Edit {
  id: string;
  page: number;
  text: string;
}

export async function extractPdf(file: File): Promise<ExtractResponse> {
  if (!API_URL) throw new Error("VITE_API_URL is not configured");
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_URL}/extract`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`Extract failed: ${res.status}`);
  return res.json();
}

export async function savePdf(fileId: string, edits: Edit[]): Promise<Blob> {
  if (!API_URL) throw new Error("VITE_API_URL is not configured");
  const res = await fetch(`${API_URL}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, edits }),
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  return res.blob();
}
