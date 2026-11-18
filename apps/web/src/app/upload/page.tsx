"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, Field, PageHeader, ScoreBadge, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Job, Paged } from "@/lib/types";

interface UploadResult {
  batchId: string;
  accepted: { id: string; fileName: string; duplicateOf?: string }[];
  rejected: { fileName: string; reason: string }[];
}

interface BatchStatus {
  batchId: string;
  total: number;
  jobId: string | null;
  counts: Record<string, number>;
  done: boolean;
  resumes: { id: string; fileName: string; status: string; error: string | null; candidateId: string | null; overallConfidence: number | null; parseMethod: string | null }[];
}

export default function UploadPage() {
  return (
    <AppShell>
      <Suspense fallback={<Spinner />}>
        <Upload />
      </Suspense>
    </AppShell>
  );
}

function Upload() {
  const params = useSearchParams();
  const [jobId, setJobId] = useState(params.get("jobId") ?? "");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<{ aiEnabled: boolean; maxUploadMb: number; maxFilesPerRequest: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Paged<Job>>("/jobs?status=PUBLISHED&pageSize=100").then((d) => setJobs(d.items)).catch(() => setJobs([]));
    api<typeof capabilities>("/resumes/capabilities").then(setCapabilities).catch(() => undefined);
  }, []);

  const poll = useCallback(async (batchId: string) => {
    const s = await api<BatchStatus>(`/resumes/batches/${batchId}`);
    setStatus(s);
    return s.done;
  }, []);

  useEffect(() => {
    if (!result || status?.done) return;
    const timer = setInterval(() => {
      void poll(result.batchId).then((done) => done && clearInterval(timer));
    }, 2000);
    void poll(result.batchId);
    return () => clearInterval(timer);
  }, [result, status?.done, poll]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, capabilities?.maxFilesPerRequest ?? 100));
  }

  async function submit() {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    setStatus(null);
    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (jobId) form.append("jobId", jobId);
    try {
      const res = await api<UploadResult>("/resumes/upload", { form });
      setResult(res);
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const parsed = status?.resumes.filter((r) => r.status === "PARSED") ?? [];
  const failed = status?.resumes.filter((r) => r.status === "FAILED") ?? [];
  const pending = status ? status.resumes.length - parsed.length - failed.length : 0;

  return (
    <>
      <PageHeader title="Upload resumes" subtitle="PDF, DOC, DOCX, or a ZIP archive of resumes. Parsing runs in the background." />

      {!capabilities?.aiEnabled && (
        <Alert kind="warning">
          AI parsing is not configured. Resumes will be parsed with the rule-based extractor, which finds contact details and known skills but less structure.
          Set <code>ANTHROPIC_API_KEY</code> in the API environment for full extraction.
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card space-y-4 p-5 lg:col-span-2">
          <Field label="Add candidates to a job" hint="Optional. Parsed candidates enter that job's pipeline at the Applied stage.">
            <select className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Talent pool only — no job</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </Field>

          <div
            className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${dragging ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20" : ""}`}
            style={dragging ? undefined : { borderColor: "var(--border)" }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
          >
            <p className="text-sm font-medium">Drag resumes here</p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              or
            </p>
            <button type="button" className="btn-secondary mt-2" onClick={() => inputRef.current?.click()}>
              Choose files
            </button>
            <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.zip,application/pdf,application/zip" className="hidden" onChange={(e) => addFiles(e.target.files)} />
            <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              Up to {capabilities?.maxFilesPerRequest ?? 100} files per upload, {capabilities?.maxUploadMb ?? 10} MB each. ZIP archives are expanded automatically.
            </p>
          </div>

          {files.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">{files.length} file{files.length === 1 ? "" : "s"} ready</p>
                <button className="text-sm text-brand-600 hover:underline" onClick={() => setFiles([])}>
                  Clear
                </button>
              </div>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded px-2 py-1" style={{ background: "var(--surface-sunken)" }}>
                    <span className="truncate">{f.name}</span>
                    <span className="ml-2 shrink-0 text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button className="btn-primary w-full" disabled={!files.length || uploading} onClick={() => void submit()}>
            {uploading ? "Uploading…" : `Upload ${files.length || ""} resume${files.length === 1 ? "" : "s"}`}
          </button>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Processing</h2>
          {!result && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Upload resumes to see parsing progress here.
            </p>
          )}

          {result && (
            <div className="space-y-3">
              {result.rejected.length > 0 && (
                <Alert kind="warning">
                  {result.rejected.length} file{result.rejected.length === 1 ? " was" : "s were"} rejected:
                  <ul className="mt-1 list-inside list-disc text-xs">
                    {result.rejected.slice(0, 5).map((r, i) => (
                      <li key={i}>
                        {r.fileName}: {r.reason}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}

              <dl className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Parsed" value={parsed.length} />
                <Stat label="In progress" value={pending} />
                <Stat label="Failed" value={failed.length} />
              </dl>

              {!status?.done && <Spinner label="Parsing resumes…" />}

              {parsed.length > 0 && (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                  {parsed.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link className="truncate hover:underline" href={r.candidateId ? `/candidates/${r.candidateId}` : "#"}>
                        {r.fileName}
                      </Link>
                      {r.overallConfidence != null && <ScoreBadge score={Math.round(r.overallConfidence * 100)} size="sm" />}
                    </li>
                  ))}
                </ul>
              )}

              {failed.length > 0 && (
                <ul className="space-y-1 text-xs text-red-600">
                  {failed.map((r) => (
                    <li key={r.id}>
                      {r.fileName}: {r.error}
                    </li>
                  ))}
                </ul>
              )}

              {status?.done && (
                <Link className="btn-primary w-full" href={status.jobId ? `/jobs/${status.jobId}` : "/candidates"}>
                  {status.jobId ? "Go to the job pipeline" : "View candidates"}
                </Link>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg p-2" style={{ background: "var(--surface-sunken)" }}>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      <dt className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
    </div>
  );
}
