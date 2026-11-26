import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import yauzl from "yauzl";
import mammoth from "mammoth";

const limit = 450_000;
const decode = bytes => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

function archiveEntries(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, archive) => {
      if (error) return reject(error);
      const names = new Set();
      let expanded = 0;
      let read = 0;
      let finished = false;
      function fail() {
        if (finished) return;
        finished = true;
        archive.close();
        reject(new Error("INVALID_DOCX"));
      }
      archive.on("error", fail);
      archive.on("end", () => {
        if (!names.has("word/document.xml") || !names.has("[Content_Types].xml")) return fail();
        if (!finished) { finished = true; resolve(); }
      });
      archive.on("entry", entry => {
        const name = entry.fileName;
        expanded += entry.uncompressedSize;
        if (++read > 180 || expanded > 9_000_000 || entry.uncompressedSize > 3_000_000
            || entry.uncompressedSize / Math.max(1,entry.compressedSize) > 220 || entry.isEncrypted()
            || names.has(name) || /(?:^|\/)\.\.(?:\/|$)|^\/|:|\\/u.test(name)
            || /(?:vbaproject|activex|embeddings\/|\.exe$|\.bin$)/i.test(name)) return fail();
        names.add(name);
        if (!/\.(?:xml|rels)$/i.test(name)) return archive.readEntry();
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail();
          const chunks = [];
          stream.on("data", chunk => chunks.push(chunk));
          stream.once("error", fail);
          stream.once("end", () => {
            try {
              const xml = decode(Buffer.concat(chunks));
              if (/<!DOCTYPE|<!ENTITY|macroEnabled|TargetMode\s*=\s*["']External/i.test(xml)) return fail();
              if (!finished) archive.readEntry();
            } catch { fail(); }
          });
        });
      });
      archive.readEntry();
    });
  });
}

function splitText(text, markdown) {
  if (!markdown) return [{ text, section: null, page: null }];
  const sections = [];
  let section = null;
  let lines = [];
  function append() {
    if (lines.some(line => line.trim())) sections.push({ section, page: null, text: lines.join("\n") });
    lines = [];
  }
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker && (!fence || marker[1].startsWith(fence))) fence = fence ? null : marker[1][0];
    const heading = !fence && line.match(/^ {0,3}#{1,6}\s+(.{1,180})\s*$/);
    if (heading) {
      append();
      section = heading[1].replace(/\s+#+$/, "").trim();
    }
    lines.push(line);
  }
  append();
  return sections;
}

async function extract(bytes, type) {
  if (type === "pdf") {
    const require = createRequire(import.meta.url);
    const dir = dirname(require.resolve("pdfjs-dist/package.json"));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
      useWasm: false, stopAtErrors: true, verbosity: 0, standardFontDataUrl: join(dir,"standard_fonts").replaceAll("\\","/") + "/"
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 100) throw new Error("PDF_PAGE_LIMIT");
      const sections = [];
      let total = 0;
      for (let page = 1; page <= pdf.numPages; page++) {
        const current = await pdf.getPage(page);
        const content = await current.getTextContent();
        const text = content.items.filter(item => typeof item.str === "string").map(item => item.str + (item.hasEOL ? "\n" : " ")).join("");
        if ((total += text.length) > limit) throw new Error("TEXT_LIMIT");
        sections.push({ text, page, section: null });
        current.cleanup();
      }
      return sections;
    } finally { await task.destroy(); }
  }
  if (type === "docx") {
    await archiveEntries(bytes);
    const result = await mammoth.extractRawText({ buffer: bytes }, { externalFileAccess: false });
    return splitText(result.value, false);
  }
  const text = decode(bytes);
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(text)) throw new Error("INVALID_TEXT");
  return splitText(text, type === "md");
}

try {
  const sections = await extract(Buffer.from(workerData.bytes),workerData.type);
  const normalized = sections.map(part => ({ ...part, text: part.text.normalize("NFC").replace(/\r\n?/g,"\n").replace(/\u0000/g,"").trim() })).filter(part => part.text);
  if (!normalized.length) throw new Error("NO_TEXT");
  if (normalized.length > 500 || normalized.reduce((sum,part) => sum + part.text.length,0) > limit) throw new Error("TEXT_LIMIT");
  parentPort.postMessage({ sections: normalized });
} catch (error) {
  const known = ["PDF_PAGE_LIMIT","TEXT_LIMIT","INVALID_DOCX","NO_TEXT","INVALID_TEXT"];
  parentPort.postMessage({ error: known.includes(error.message) ? error.message : "PARSE_FAILED" });
}
