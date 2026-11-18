import AdmZip from "adm-zip";

export type ResumeKind = "pdf" | "docx" | "doc";

export const MIME_BY_KIND: Record<ResumeKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
};

/**
 * Detect the real file type from magic bytes - the client-supplied MIME type and
 * extension are not trusted. Returns null for anything that isn't a supported resume.
 */
export function detectResumeKind(data: Buffer): ResumeKind | null {
  if (data.length < 8) return null;
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (data.readUInt32BE(0) === 0xd0cf11e0) return "doc"; // OLE2 compound file
  if (isZip(data)) {
    try {
      const zip = new AdmZip(data);
      const names = zip.getEntries().map((e) => e.entryName);
      if (names.includes("word/document.xml")) {
        // Reject macro-enabled documents (.docm) - common malware vector.
        if (names.some((n) => n.toLowerCase().includes("vbaproject.bin"))) return null;
        return "docx";
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function isZip(data: Buffer): boolean {
  return data.length >= 4 && data.readUInt32BE(0) === 0x504b0304;
}

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

/**
 * Expand a ZIP of resumes with zip-bomb guards. Entries are only read into memory;
 * nothing is written to disk by entry name, so path traversal in names is harmless.
 */
export function expandZip(data: Buffer, limits: ZipLimits): { name: string; data: Buffer }[] {
  const zip = new AdmZip(data);
  const entries = zip.getEntries().filter((e) => {
    if (e.isDirectory) return false;
    const base = e.entryName.split("/").pop() ?? "";
    return !base.startsWith(".") && !e.entryName.startsWith("__MACOSX/") && /\.(pdf|docx?)$/i.test(base);
  });
  if (entries.length > limits.maxEntries) throw new Error(`ZIP contains more than ${limits.maxEntries} files`);

  let total = 0;
  return entries.map((e) => {
    if (e.header.size > limits.maxEntryBytes) throw new Error(`${e.entryName} exceeds the per-file size limit`);
    total += e.header.size;
    if (total > limits.maxTotalBytes) throw new Error("ZIP expands beyond the allowed total size");
    const content = e.getData();
    if (content.length > limits.maxEntryBytes) throw new Error(`${e.entryName} exceeds the per-file size limit`);
    return { name: e.entryName.split("/").pop() ?? e.entryName, data: content };
  });
}
