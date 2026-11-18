"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { CareersShell, employmentLabel, salaryLabel, Tag, workModeLabel } from "@/components/careers-shell";
import { Alert, EmptyState, Spinner, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { CareersBoard } from "@/lib/types";

/**
 * The employer's public job board at /careers/<slug>. It needs no account, so it
 * reads only from /api/public/careers and never touches the session.
 */
export default function CareersBoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <Board slug={slug} />;
}

interface Filters {
  search: string;
  department: string;
  location: string;
  workMode: string;
  employmentType: string;
}

const EMPTY: Filters = { search: "", department: "", location: "", workMode: "", employmentType: "" };
const PAGE_SIZE = 20;

function Board({ slug }: { slug: string }) {
  const [board, setBoard] = useState<CareersBoard | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (f: Filters, p: number, signal?: AbortSignal) => {
      const query = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
      for (const [key, value] of Object.entries(f)) if (value) query.set(key, value);
      try {
        setLoading(true);
        setBoard(await api<CareersBoard>(`/public/careers/${encodeURIComponent(slug)}?${query}`, { signal }));
        setError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setError(e instanceof ApiError ? e.message : "This careers page could not be loaded.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [slug],
  );

  // Typing in the search box re-queries after a pause, so each keystroke is not a request.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(filters, page, controller.signal), filters.search ? 300 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, page, load]);

  function set<K extends keyof Filters>(key: K, value: string) {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  }

  if (error && !board) {
    return (
      <CareersShell>
        <Alert>{error}</Alert>
      </CareersShell>
    );
  }
  if (!board) {
    return (
      <CareersShell>
        <Spinner label="Loading open roles…" />
      </CareersShell>
    );
  }

  const { organization: org, filters: facets, items, total } = board;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Object.values(filters).some(Boolean);

  return (
    <CareersShell org={org}>
      <section className="mb-7">
        <h1 className="text-2xl font-semibold sm:text-3xl">Open roles at {org.name}</h1>
        {org.intro && (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--text-muted)" }}>
            {org.intro}
          </p>
        )}
        <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
          {total === 0 ? "No vacancies are open right now." : `${total} ${total === 1 ? "vacancy" : "vacancies"} open.`}
        </p>
      </section>

      <section className="card mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="lg:col-span-2">
            <span className="label">Search</span>
            <input
              className="input"
              placeholder="Role or skill"
              value={filters.search}
              onChange={(e) => set("search", e.target.value)}
            />
          </label>
          <Select label="Department" value={filters.department} options={facets.departments} onChange={(v) => set("department", v)} />
          <Select label="Location" value={filters.location} options={facets.locations} onChange={(v) => set("location", v)} />
          <Select
            label="Work mode"
            value={filters.workMode}
            options={facets.workModes}
            labelOf={workModeLabel}
            onChange={(v) => set("workMode", v)}
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            label="Type"
            value={filters.employmentType}
            options={facets.employmentTypes}
            labelOf={employmentLabel}
            onChange={(v) => set("employmentType", v)}
          />
          {filtered && (
            <div className="flex items-end">
              <button type="button" className="btn btn-ghost text-sm" onClick={() => { setFilters(EMPTY); setPage(1); }}>
                Clear filters
              </button>
            </div>
          )}
        </div>
      </section>

      {loading && <Spinner label="Updating…" />}

      {!loading && items.length === 0 && (
        <EmptyState
          title={filtered ? "No roles match those filters" : "No roles are open just now"}
          description={
            filtered
              ? "Try a broader search, or clear the filters to see everything that is open."
              : `Check back later — new vacancies at ${org.name} appear here as soon as they are published.`
          }
          action={
            filtered ? (
              <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY); setPage(1); }}>
                Clear filters
              </button>
            ) : undefined
          }
        />
      )}

      <ul className="space-y-3">
        {items.map((job) => (
          <li key={job.id}>
            <Link
              href={`/careers/${org.slug}/jobs/${job.id}`}
              className="card block p-5 transition-shadow hover:shadow-md focus-visible:outline-2"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold">{job.title}</h2>
                {job.department && (
                  <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {job.department}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {job.teaser}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {job.location && <Tag>{job.location}</Tag>}
                <Tag>{workModeLabel(job.workMode)}</Tag>
                <Tag>{employmentLabel(job.employmentType)}</Tag>
                {job.experience && <Tag>{job.experience}</Tag>}
                {job.salary && <Tag>{salaryLabel(job.salary)}</Tag>}
              </div>
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Posted {timeAgo(job.postedAt)}
                {job.closesAt && ` · closes ${new Date(job.closesAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-between text-sm">
          <button type="button" className="btn btn-secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span style={{ color: "var(--text-muted)" }}>
            Page {page} of {pages}
          </span>
          <button type="button" className="btn btn-secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </nav>
      )}
    </CareersShell>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  labelOf = (v: string) => v,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  labelOf?: (v: string) => string;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={options.length === 0}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labelOf(o)}
          </option>
        ))}
      </select>
    </label>
  );
}
