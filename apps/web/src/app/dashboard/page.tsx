"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { MeterList, StatTile } from "@/components/charts";
import { Alert, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { AiOversight, JobPerformance, Overview } from "@/lib/types";

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const { org } = useSession();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ overview: Overview; jobs: JobPerformance[]; ai: AiOversight } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    setData(null);
    setError(null);
    Promise.all([
      api<Overview>(`/analytics/overview?days=${days}`),
      api<JobPerformance[]>("/analytics/jobs"),
      api<AiOversight>(`/analytics/ai-oversight?days=${days}`),
    ])
      .then(([overview, jobs, ai]) => !cancelled && setData({ overview, jobs, ai }))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load analytics"));
    return () => {
      cancelled = true;
    };
  }, [org, days]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner label="Loading analytics…" />;

  const { overview, jobs, ai } = data;
  const applied = overview.funnel.find((f) => f.kind === "APPLIED")?.count ?? 0;
  const funnelMax = Math.max(...overview.funnel.map((f) => f.count), 1);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Hiring activity over the last ${days} days`}
        actions={
          <select className="input w-auto py-1.5 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Reporting period">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 12 months</option>
          </select>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active jobs" value={overview.jobs.active} sub={`${overview.jobs.draft} in draft`} />
        <StatTile label="Candidates" value={overview.candidates.total} sub={`${overview.candidates.new} added this period`} />
        <StatTile label="Applications" value={overview.applications.total} sub={`${overview.applications.new} new · ${overview.applications.hired} hired`} />
        <StatTile
          label="Awaiting AI review"
          value={overview.pendingMatchReviews}
          sub={overview.pendingMatchReviews ? "Recommendations need a human decision" : "All recommendations reviewed"}
          tone={overview.pendingMatchReviews > 0 ? "attention" : "default"}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-3">
          <div className="mb-4 flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">Recruitment funnel</h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Active applications by stage
            </p>
          </div>
          <MeterList
            max={funnelMax}
            emptyLabel="No applications in the pipeline yet"
            rows={overview.funnel
              .filter((f) => f.kind !== "REJECTED")
              .map((f) => ({
                label: f.name,
                value: f.count,
                note: applied && f.kind !== "APPLIED" ? `${Math.round((f.count / applied) * 100)}%` : undefined,
              }))}
          />
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Resume processing</h2>
          <MeterList
            rows={[
              { label: "Parsed", value: overview.resumeProcessing.parsed },
              { label: "In progress", value: overview.resumeProcessing.pending },
              { label: "Failed", value: overview.resumeProcessing.failed },
            ]}
          />
          <dl className="mt-4 space-y-1.5 border-t pt-3 text-sm" style={{ borderColor: "var(--border)" }}>
            <div className="flex justify-between">
              <dt style={{ color: "var(--text-muted)" }}>Parsing success rate</dt>
              <dd className="font-medium tabular-nums">{overview.resumeProcessing.successRate != null ? `${overview.resumeProcessing.successRate}%` : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt style={{ color: "var(--text-muted)" }}>Average time to hire</dt>
              <dd className="font-medium tabular-nums">{overview.timeToHireDays != null ? `${overview.timeToHireDays} days` : "—"}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="card mt-4 p-5">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-semibold">AI oversight</h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            AI recommendations are advisory; every outcome is a human decision
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Recommendations reviewed" value={ai.reviewedShare != null ? `${ai.reviewedShare}%` : "—"} />
          <Metric label="Accepted as scored" value={ai.acceptanceRate != null ? `${ai.acceptanceRate}%` : "—"} />
          <Metric
            label="Average human adjustment"
            value={ai.averageHumanAdjustment != null ? `${ai.averageHumanAdjustment > 0 ? "+" : ""}${ai.averageHumanAdjustment} pts` : "—"}
          />
          <Metric label="Pending review" value={ai.reviews.PENDING ?? 0} />
        </div>
        {ai.usage.length > 0 && (
          <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              AI usage this period
            </p>
            <ul className="flex flex-wrap gap-2">
              {ai.usage.map((u) => (
                <li key={u.feature} className="chip">
                  {u.feature.replace(/_/g, " ")}: {u.calls} calls · {((u.inputTokens + u.outputTokens) / 1000).toFixed(1)}k tokens
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card mt-4 overflow-hidden">
        <div className="flex items-baseline justify-between gap-2 px-5 py-4">
          <h2 className="font-semibold">Job performance</h2>
          <Link className="text-sm text-brand-600 hover:underline" href="/jobs">
            All jobs
          </Link>
        </div>
        {jobs.length === 0 ? (
          <p className="px-5 pb-5 text-sm" style={{ color: "var(--text-muted)" }}>
            No jobs yet.{" "}
            <Link className="text-brand-600 hover:underline" href="/jobs/new">
              Create your first job
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y text-left" style={{ borderColor: "var(--border)", background: "var(--surface-sunken)" }}>
                  <th className="px-5 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 text-right font-medium">Applications</th>
                  <th className="px-3 py-2 text-right font-medium">Shortlisted</th>
                  <th className="px-3 py-2 text-right font-medium">Interviewed</th>
                  <th className="px-3 py-2 text-right font-medium">Hired</th>
                  <th className="px-5 py-2 text-right font-medium">Avg. match</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="px-5 py-2.5">
                      <Link className="font-medium hover:underline" href={`/jobs/${job.id}`}>
                        {job.title}
                      </Link>
                      <span className="ml-2 chip">{job.status.toLowerCase()}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{job.applications}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {job.shortlisted}
                      <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                        {job.shortlistRate}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{job.interviewed}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{job.hired}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{job.averageMatchScore ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
