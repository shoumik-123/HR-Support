"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, EmptyState, PageHeader, Spinner, timeAgo } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { CalendarResponse, InterviewKind, InterviewStatus } from "@/lib/types";

const KIND_LABEL: Record<InterviewKind, string> = {
  SCREENING: "Screening",
  TECHNICAL: "Technical",
  BEHAVIORAL: "Behavioural",
  PANEL: "Panel",
  HR: "HR",
  FINAL: "Final",
};

export default function InterviewsPage() {
  return (
    <AppShell>
      <Interviews />
    </AppShell>
  );
}

interface MyInterviews {
  upcoming: { id: string; title: string; startsAt: string; timezone: string; candidate: { id: string; fullName: string; headline: string | null }; job: { id: string; title: string } }[];
  pendingFeedback: { scorecardId: string; interviewId: string; interviewTitle: string; startedAt: string; job: { id: string; title: string }; candidate: { id: string; fullName: string } }[];
}

function Interviews() {
  const { me } = useSession();
  const [weekOffset, setWeekOffset] = useState(0);
  const [mineOnly, setMineOnly] = useState(false);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [mine, setMine] = useState<MyInterviews | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { from, to, days } = weekWindow(weekOffset);

  const load = useCallback(() => {
    setError(null);
    api<CalendarResponse>(`/interviews/calendar?from=${from.toISOString()}&to=${to.toISOString()}&mine=${mineOnly}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the calendar"));
  }, [from, to, mineOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<MyInterviews>("/interviews/mine").then(setMine).catch(() => setMine(null));
  }, []);

  return (
    <>
      <PageHeader
        title="Interviews"
        subtitle={data ? `Times shown in ${data.timezone}` : undefined}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
              Only mine
            </label>
            <div className="flex gap-1">
              <button className="btn-secondary py-1.5" onClick={() => setWeekOffset((w) => w - 1)} aria-label="Previous week">
                ←
              </button>
              <button className="btn-secondary py-1.5" onClick={() => setWeekOffset(0)}>
                This week
              </button>
              <button className="btn-secondary py-1.5" onClick={() => setWeekOffset((w) => w + 1)} aria-label="Next week">
                →
              </button>
            </div>
          </>
        }
      />

      {mine && mine.pendingFeedback.length > 0 && (
        <Alert kind="warning">
          <p className="font-medium">You have {mine.pendingFeedback.length} interview{mine.pendingFeedback.length === 1 ? "" : "s"} awaiting your feedback</p>
          <ul className="mt-1.5 space-y-1">
            {mine.pendingFeedback.map((p) => (
              <li key={p.scorecardId}>
                <Link className="underline" href={`/interviews/${p.interviewId}`}>
                  {p.candidate.fullName} — {p.job.title}
                </Link>{" "}
                <span className="text-xs">({timeAgo(p.startedAt)})</span>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {error && <Alert>{error}</Alert>}
      {!data && !error && <Spinner />}

      {data && (
        <>
          <p className="mb-3 mt-4 text-sm font-medium">
            {from.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – {to.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </p>

          {data.interviews.length === 0 ? (
            <EmptyState
              title="No interviews this week"
              description="Schedule interviews from a candidate's pipeline card or their profile."
              action={
                <Link className="btn-primary" href="/jobs">
                  Go to jobs
                </Link>
              }
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-7">
              {days.map((day) => {
                const dayInterviews = data.interviews.filter((i) => sameDay(new Date(i.startsAt), day));
                const isToday = sameDay(day, new Date());
                return (
                  <section key={day.toISOString()} className="card min-h-32 p-2">
                    <header className="mb-2 px-1">
                      <p className={`text-xs font-medium uppercase tracking-wide ${isToday ? "text-brand-600" : ""}`} style={isToday ? undefined : { color: "var(--text-muted)" }}>
                        {day.toLocaleDateString("en-GB", { weekday: "short" })}
                      </p>
                      <p className={`text-lg font-semibold tabular-nums ${isToday ? "text-brand-600" : ""}`}>{day.getDate()}</p>
                    </header>
                    <ul className="space-y-1.5">
                      {dayInterviews.map((i) => (
                        <li key={i.id}>
                          <Link
                            href={`/interviews/${i.id}`}
                            className="block rounded-lg p-2 text-xs transition-colors hover:bg-[var(--surface-sunken)]"
                            style={{ background: "var(--surface-sunken)", opacity: i.status === "CANCELLED" ? 0.5 : 1 }}
                          >
                            <p className="font-medium tabular-nums">
                              {new Date(i.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                            <p className="truncate font-medium">{i.candidate.fullName}</p>
                            <p className="truncate" style={{ color: "var(--text-muted)" }}>
                              {KIND_LABEL[i.kind]} · {i.job.title}
                            </p>
                            <p className="mt-1 truncate" style={{ color: "var(--text-muted)" }}>
                              {i.interviewers.map((p) => p.name.split(" ")[0]).join(", ")}
                            </p>
                            <StatusTag status={i.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}

          {mine && mine.upcoming.length > 0 && (
            <section className="card mt-6 p-5">
              <h2 className="mb-3 font-semibold">Your next interviews</h2>
              <ul className="space-y-2">
                {mine.upcoming.slice(0, 5).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0" style={{ borderColor: "var(--border)" }}>
                    <div>
                      <Link className="font-medium hover:underline" href={`/interviews/${i.id}`}>
                        {i.candidate.fullName}
                      </Link>
                      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                        {i.job.title}
                        {i.candidate.headline ? ` · ${i.candidate.headline}` : ""}
                      </p>
                    </div>
                    <p className="text-sm tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {new Date(i.startsAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

export function StatusTag({ status }: { status: InterviewStatus }) {
  if (status === "SCHEDULED") return null;
  const tone: Record<string, string> = {
    COMPLETED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
    CANCELLED: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
    NO_SHOW: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  };
  return <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${tone[status]}`}>{status.replace("_", " ").toLowerCase()}</span>;
}

function weekWindow(offset: number) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + offset * 7);
  start.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const to = new Date(days[6]);
  to.setHours(23, 59, 59, 999);
  return { from: start, to, days };
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
