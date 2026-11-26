import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { HttpError } from "@/server/db/http";

const types = {
  txt: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};
export type FileKind = keyof typeof types;
export type Span = { text: string; page: number | null; section: string | null };
export type Chunk = Span & { ordinal: number; start: number; end: number };

export function validateFile(name: string, bytes: Buffer) {
  const title = name.normalize("NFC").trim();
  const kind = title.split(".").at(-1)?.toLowerCase() as FileKind;
  if (!title.includes(".") || !Object.hasOwn(types,kind) || /[\\/\p{Cc}\p{Cf}]/u.test(title) || title.length > 180) {
    throw new HttpError(415,"UNSUPPORTED_FILE","Choose a PDF, DOCX, TXT, or Markdown file with a valid name.");
  }
  const signature = bytes.subarray(0,8);
  if ((kind === "pdf" && !signature.toString("ascii").startsWith("%PDF-"))
      || (kind === "docx" && !signature.subarray(0,4).equals(Buffer.from([80,75,3,4])))
      || ((kind === "txt" || kind === "md") && signature.includes(0))) {
    throw new HttpError(415,"INVALID_SIGNATURE","The file contents do not match the selected format.");
  }
  return { title, kind, mime: types[kind] };
}

export function kindFromMime(mime: string) {
  return (Object.entries(types).find(([,value]) => value === mime)?.[0] ?? "txt") as FileKind;
}

export function extract(bytes: Buffer, kind: FileKind): Promise<Span[]> {
  return new Promise((resolve,reject) => {
    const entry=join(process.cwd(),"src","server","ingestion","parser-worker.mjs");
    // Load the native ESM entry so PDF.js resolves its own package files at runtime.
    const worker:Worker = Reflect.construct(Worker,[entry,{
      workerData: { bytes, type: kind },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 24, stackSizeMb: 4 },
      stdout: true, stderr: true
    }]);
    worker.stdout.resume();
    worker.stderr.resume();
    function finish(error: string | null, sections?: Span[]) {
      clearTimeout(timer);
      void worker.terminate().catch(() => {});
      if (error) reject(new Error(error));
      else if (sections) resolve(sections);
    }
    const timer = setTimeout(() => finish("PARSE_TIMEOUT"), 7500);
    worker.once("message", (result: { sections?: Span[]; error?: string }) => finish(result.error ?? null,result.sections));
    worker.once("error", () => finish("PARSE_FAILED"));
    worker.once("exit", () => finish("PARSE_FAILED"));
  });
}

export function chunkSpans(spans: Span[]) {
  const chunks: Chunk[] = [];
  let offset = 0;
  for (const span of spans) {
    for (let start = 0; start < span.text.length;) {
      let end = Math.min(start + 1950,span.text.length);
      if (end < span.text.length) {
        const boundary = span.text.lastIndexOf(" ",end);
        if (boundary > start + 1250) end = boundary;
        if (/[\uDC00-\uDFFF]/.test(span.text[end])) end--;
      }
      const text = span.text.slice(start,end);
      if (text.trim()) chunks.push({ ...span, text, ordinal: chunks.length, start: offset+start, end: offset+end });
      if (end === span.text.length) break;
      start = Math.max(start+1,end-240);
      if (/[\uDC00-\uDFFF]/.test(span.text[start])) start++;
    }
    offset += span.text.length + 1;
  }
  return chunks;
}
