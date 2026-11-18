"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, EmptyState, PageHeader, Spinner, TagInput, timeAgo } from "@/components/ui";
import { api } from "@/lib/api";
import type { CandidateSummary, Paged } from "@/lib/types";

export default function CandidatesPage() {
  return (
    <AppShell>
      <Candidates />
    </AppShell>
  );
}

function Candidates() {
  const [search, setSearch] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [minExperience, setMinExperience] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<CandidateSummary> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), pageSize: "24" });
      if (search.trim()) params.set("search", search.trim());
      if (skills.length) params.set("skills", skills.join(","));
      if (minExperience) params.set("minExperience", minExperience);
      setError(null);
      api<Paged<CandidateSummary>>(`/candidates?${params}`, { signal: controller.signal })
        .then(setData)
        .catch((e) => e.name !== "AbortError" && setError(e.message));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, skills, minExperience, page]);

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <>
      <PageHeader title="Talent pool" subtitle="Every candidate in your organization, searchable across jobs" />

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label className="label" htmlFor="q">
            Search
          </label>
          <input id="q" className="input" placeholder="Name, headline, skill or tag" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label className="label">Must have all skills</label>
          <TagInput value={skills} onChange={(v) => { setSkills(v); setPage(1); }} placeholder="e.g. React" />
        </div>
        <div>
          <label className="label" htmlFor="exp">
            Min. experience
          </label>
          <input id="exp" className="input w-28" type="number" min={0} max={60} value={minExperience} onChange={(e) => { setMinExperience(e.target.value); setPage(1); }} />
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data && !error && <Spinner />}

      {data && (
        <>
          <p className="mb-3 text-sm" style={{ color: "var(--text-muted)" }}>
            {data.total} candidate{data.total === 1 ? "" : "s"}
          </p>

          {data.items.length === 0 ? (
            <EmptyState
              title="No candidates match"
              description="Try fewer filters, or upload resumes to grow your talent pool."
              action={
                <Link className="btn-primary" href="/upload">
                  Upload resumes
                </Link>
              }
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.items.map((c) => (
                <Link key={c.id} href={`/candidates/${c.id}`} className="card block p-4 transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate font-medium">{c.fullName}</h2>
                      {c.headline && (
                        <p className="truncate text-sm" style={{ color: "var(--text-muted)" }}>
                          {c.headline}
                        </p>
                      )}
                    </div>
                    {c.totalExperienceYears != null && <span className="chip shrink-0">{c.totalExperienceYears} yrs</span>}
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {c.skills.slice(0, 5).map((s) => (
                      <span key={s} className="chip">
                        {s}
                      </span>
                    ))}
                    {c.skills.length > 5 && <span className="chip">+{c.skills.length - 5}</span>}
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t pt-2.5 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                    <span>
                      {c._count?.applications ?? 0} application{c._count?.applications === 1 ? "" : "s"} · {c._count?.resumes ?? 0} resume
                      {c._count?.resumes === 1 ? "" : "s"}
                    </span>
                    {c.createdAt && <span>{timeAgo(c.createdAt)}</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button className="btn-secondary py-1.5" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                Page {page} of {totalPages}
              </span>
              <button className="btn-secondary py-1.5" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
