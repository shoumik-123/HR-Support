import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { ResumeKind } from "./file-types";

export interface ExtractedText {
  text: string;
  pageCount?: number;
  /** True when the document has little or no text layer (likely scanned) and needs OCR. */
  needsOcr: boolean;
}

const MIN_TEXT_CHARS = 200;

export async function extractText(kind: ResumeKind, data: Buffer): Promise<ExtractedText> {
  switch (kind) {
    case "pdf": {
      const parser = new PDFParse({ data: new Uint8Array(data) });
      try {
        const result = await parser.getText();
        const text = cleanup(result.text);
        return { text, pageCount: result.total, needsOcr: text.replace(/\s/g, "").length < MIN_TEXT_CHARS };
      } finally {
        await parser.destroy();
      }
    }
    case "docx": {
      const result = await mammoth.extractRawText({ buffer: data });
      const text = cleanup(result.value);
      return { text, needsOcr: false };
    }
    case "doc": {
      // Legacy binary .doc: pull out readable text runs. Good enough for keyword/contact
      // extraction; recruiters can upload a PDF/DOCX for full fidelity.
      const text = cleanup(legacyDocText(data));
      return { text, needsOcr: false };
    }
  }
}

function legacyDocText(data: Buffer): string {
  // Word 97-2003 stores body text as UTF-16LE or 8-bit runs; try both and keep the longer.
  const utf16 = data.toString("utf16le").match(/[\p{L}\p{N}\p{P}\p{Zs}\r\n]{4,}/gu) ?? [];
  const latin = data.toString("latin1").match(/[\x20-\x7e\r\n\t]{6,}/g) ?? [];
  const a = utf16.join("\n");
  const b = latin.join("\n");
  return a.length > b.length ? a : b;
}

function cleanup(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/-- \d+ of \d+ --/g, "") // pdf-parse page markers
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
