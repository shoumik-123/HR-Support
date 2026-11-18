"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, EmptyState, PageHeader, Spinner, timeAgo } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Job, JobStatus, Paged } from "@/lib/types";

const STATUSES: (JobStatus | "ALL")[] = ["ALL", "PUBLISHED", "DRAFT", "CLOSED"];

export default function JobsPage() {
  return (
    <AppShell>
      <Jobs />
    </AppShell>
  );
}

function Jobs() {
  const { can } = useSession();
  const [status, setStatus] = useState<JobStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Paged<Job> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ pageSize: "50" });
      if (status !== "ALL") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      setError(null);
      api<Paged<Job>>(`/jobs?${params}`, { signal: controller.signal })
        .then(setData)
        .catch((e) => e.name !== "AbortError" && setError(e.message));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [status, search]);

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="Vacancies and their hiring pipelines"
        actions={
          can("job:manage") && (
            <Link className="btn-primary" href="/jobs/new">
              New job
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search job titles…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search jobs" />
        <div className="flex gap-1" role="group" aria-label="Filter by status">
          {STATUSES.map((s) => (
            <button key={s} className={s === status ? "btn-primary py-1.5" : "btn-secondary py-1.5"} onClick={() => setStatus(s)}>
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data && !error && <Spinner />}

      {data && data.items.length === 0 && (
        <EmptyState
          title="No jobs found"
          description={search || status !== "ALL" ? "Try a different search or filter." : "Create a job to start receiving and screening candidates."}
          action={can("job:manage") && <Link className="btn-primary" href="/jobs/new">Create a job</Link>}
        />
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data?.items.map((job) => (
          <Link key={job.id} href={`/jobs/${job.id}`} className="card block p-4 transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-medium leading-snug">{job.title}</h2>
              <StatusChip status={job.status} />
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {[job.department?.name, job.location, job.workMode.toLowerCase()].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.requiredSkills.slice(0, 4).map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
              {job.requiredSkills.length > 4 && <span className="chip">+{job.requiredSkills.length - 4}</span>}
            </div>
            <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm" style={{ borderColor: "var(--border)" }}>
              <span>
                <strong className="tabular-nums">{job.activeApplicationCount ?? 0}</strong>{" "}
                <span style={{ color: "var(--text-muted)" }}>active of {job.applicationCount ?? 0}</span>
              </span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                updated {timeAgo(job.updatedAt)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

export function StatusChip({ status }: { status: JobStatus }) {
  const tone: Record<JobStatus, string> = {
    PUBLISHED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
    DRAFT: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
    CLOSED: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
    ARCHIVED: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone[status]}`}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}
