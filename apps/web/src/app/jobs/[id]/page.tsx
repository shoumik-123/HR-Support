"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StatusChip } from "@/app/jobs/page";
import { MatchDetail } from "@/components/match-detail";
import { ScheduleInterviewModal } from "@/components/schedule-interview";
import { SendAssessmentModal } from "@/components/send-assessment";
import { CreateOfferModal } from "@/components/create-offer";
import { Alert, EmptyState, Modal, PageHeader, ScoreBadge, Spinner, formatMoney, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ApplicationCard, Board, Job, MatchResult, Paged, Stage } from "@/lib/types";

type Tab = "pipeline" | "ranking" | "details";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AppShell>
      <JobWorkspace jobId={id} />
    </AppShell>
  );
}

function JobWorkspace({ jobId }: { jobId: string }) {
  const { can } = useSession();
  const [job, setJob] = useState<Job | null>(null);
  const [tab, setTab] = useState<Tab>("pipeline");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Job>(`/jobs/${jobId}`).then(setJob).catch((e) => setError(e.message)), [jobId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function runMatching(rerunAll: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const { queued } = await api<{ queued: number }>(`/jobs/${jobId}/matches/run`, { body: { rerunAll } });
      setNotice(queued ? `Screening ${queued} candidate${queued === 1 ? "" : "s"} in the background. Scores appear in the Ranking tab.` : "Every candidate already has a score. Use “Re-run all” to score them again.");
      setTab("ranking");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start matching.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(action: "publish" | "close" | "unpublish") {
    setBusy(true);
    try {
      await api(`/jobs/${jobId}/${action}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the job.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !job) return <Alert>{error}</Alert>;
  if (!job) return <Spinner />;

  return (
    <>
      <PageHeader
        title={job.title}
        subtitle={[job.department?.name, job.location, job.workMode.toLowerCase(), job.employmentType.replace("_", " ").toLowerCase()].filter(Boolean).join(" · ")}
        actions={
          <>
            <StatusChip status={job.status} />
            {can("match:run") && (
              <button className="btn-primary" disabled={busy} onClick={() => void runMatching(false)}>
                ✨ Screen candidates
              </button>
            )}
            {can("job:publish") &&
              (job.status === "PUBLISHED" ? (
                <button className="btn-secondary" disabled={busy} onClick={() => void setStatus("close")}>
                  Close job
                </button>
              ) : job.status === "DRAFT" ? (
                <button className="btn-secondary" disabled={busy} onClick={() => void setStatus("publish")}>
                  Publish
                </button>
              ) : null)}
            {can("job:manage") && (
              <Link className="btn-secondary" href={`/jobs/${job.id}/edit`}>
                Edit
              </Link>
            )}
          </>
        }
      />

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="my-4 flex gap-1 border-b" style={{ borderColor: "var(--border)" }} role="tablist">
        {(["pipeline", "ranking", "details"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? "border-brand-600 text-brand-600" : "border-transparent hover:text-brand-600"}`}
            style={tab === t ? undefined : { color: "var(--text-muted)" }}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "pipeline" && <PipelineBoard jobId={jobId} />}
      {tab === "ranking" && <Ranking jobId={jobId} onRerun={() => void runMatching(true)} busy={busy} />}
      {tab === "details" && <JobDetails job={job} />}
    </>
  );
}

function PipelineBoard({ jobId }: { jobId: string }) {
  const { can } = useSession();
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApplicationCard | null>(null);
  const [scheduling, setScheduling] = useState<ApplicationCard | null>(null);
  const [assessing, setAssessing] = useState<ApplicationCard | null>(null);
  const [offering, setOffering] = useState<ApplicationCard | null>(null);
  const dragOver = useRef<string | null>(null);

  const load = useCallback(() => api<Board>(`/applications/board?jobId=${jobId}`).then(setBoard).catch((e) => setError(e.message)), [jobId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function move(applicationId: string, stageId: string) {
    if (!board) return;
    const previous = board;
    // Optimistic move; reverted if the API rejects it.
    setBoard({
      ...board,
      stages: board.stages.map((s) => ({
        ...s,
        applications: s.id === stageId
          ? [...s.applications, { ...board.stages.flatMap((x) => x.applications).find((a) => a.id === applicationId)!, stageId }]
          : s.applications.filter((a) => a.id !== applicationId),
        total: s.id === stageId ? s.total + 1 : s.applications.some((a) => a.id === applicationId) ? s.total - 1 : s.total,
      })),
    });
    try {
      await api(`/applications/${applicationId}/move`, { body: { stageId } });
      await load();
    } catch (err) {
      setBoard(previous);
      setError(err instanceof ApiError ? err.message : "Could not move the candidate.");
    }
  }

  if (error && !board) return <Alert>{error}</Alert>;
  if (!board) return <Spinner />;

  const empty = board.stages.every((s) => s.total === 0);
  if (empty) {
    return (
      <EmptyState
        title="No candidates on this job yet"
        description="Upload resumes against this job, or add candidates from your talent pool."
        action={
          can("resume:upload") && (
            <Link className="btn-primary" href={`/upload?jobId=${jobId}`}>
              Upload resumes
            </Link>
          )
        }
      />
    );
  }

  return (
    <>
      {error && <Alert>{error}</Alert>}
      {board.blindMode && <Alert kind="info">Blind recruitment mode is on — candidate names and contact details are hidden while you review.</Alert>}
      <div className="mt-3 flex gap-3 overflow-x-auto pb-4">
        {board.stages.map((stage) => (
          <section
            key={stage.id}
            className="w-72 shrink-0 rounded-xl p-2"
            style={{ background: "var(--surface-sunken)", outline: dragOver.current === stage.id ? "2px solid var(--chart-series-1)" : "none" }}
            onDragOver={(e) => {
              if (!can("pipeline:move")) return;
              e.preventDefault();
              dragOver.current = stage.id;
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragOver.current = null;
              if (dragging && stage.kind !== "REJECTED") void move(dragging, stage.id);
              setDragging(null);
            }}
          >
            <header className="flex items-center justify-between px-2 py-1.5">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <span className="size-2 rounded-full" style={{ background: stage.color ?? "var(--chart-series-1)" }} aria-hidden="true" />
                {stage.name}
              </h3>
              <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                {stage.total}
              </span>
            </header>
            <ul className="space-y-2">
              {stage.applications.map((app) => (
                <li
                  key={app.id}
                  draggable={can("pipeline:move")}
                  onDragStart={() => setDragging(app.id)}
                  onDragEnd={() => setDragging(null)}
                  className={`card p-3 ${can("pipeline:move") ? "cursor-grab active:cursor-grabbing" : ""} ${dragging === app.id ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/candidates/${app.candidate.id}`} className="text-sm font-medium hover:underline">
                      {app.candidate.fullName}
                    </Link>
                    <ScoreBadge score={app.effectiveScore} size="sm" />
                  </div>
                  {app.candidate.headline && (
                    <p className="mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                      {app.candidate.headline}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {app.candidate.skills.slice(0, 3).map((s) => (
                      <span key={s} className="chip px-2 py-0.5 text-[11px]">
                        {s}
                      </span>
                    ))}
                  </div>
                  {app.match?.missingSkills && app.match.missingSkills.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">Missing: {app.match.missingSkills.slice(0, 3).join(", ")}</p>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {timeAgo(app.stageEnteredAt)}
                    </span>
                    <span className="flex items-center gap-2">
                      {can("interview:schedule") && app.status === "ACTIVE" && (
                        <button className="text-[11px] text-brand-600 hover:underline" onClick={() => setScheduling(app)}>
                          Interview
                        </button>
                      )}
                      {can("assessment:assign") && app.status === "ACTIVE" && (
                        <button className="text-[11px] text-brand-600 hover:underline" onClick={() => setAssessing(app)}>
                          Assess
                        </button>
                      )}
                      {can("offer:manage") && app.status === "ACTIVE" && (
                        <button className="text-[11px] text-brand-600 hover:underline" onClick={() => setOffering(app)}>
                          Offer
                        </button>
                      )}
                      {can("pipeline:reject") && app.status === "ACTIVE" && stage.kind !== "REJECTED" && (
                        <button className="text-[11px] text-red-600 hover:underline" onClick={() => setRejecting(app)}>
                          Reject
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              ))}
              {stage.total > stage.applications.length && (
                <li className="px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  +{stage.total - stage.applications.length} more
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>

      <RejectModal
        application={rejecting}
        onClose={() => setRejecting(null)}
        onDone={() => {
          setRejecting(null);
          void load();
        }}
      />

      {assessing && (
        <SendAssessmentModal
          open
          onClose={() => setAssessing(null)}
          applicationId={assessing.id}
          candidateName={assessing.candidate.fullName}
          onSent={() => void load()}
        />
      )}

      {offering && (
        <CreateOfferModal
          open
          onClose={() => setOffering(null)}
          applicationId={offering.id}
          candidateName={offering.candidate.fullName}
          jobTitle={board.job.title}
          currency="BDT"
          onCreated={() => {
            setOffering(null);
            router.push("/offers");
          }}
        />
      )}

      {scheduling && (
        <ScheduleInterviewModal
          open
          onClose={() => setScheduling(null)}
          applicationId={scheduling.id}
          candidateName={scheduling.candidate.fullName}
          jobTitle={board.job.title}
          onScheduled={(id) => {
            setScheduling(null);
            void load();
            router.push(`/interviews/${id}`);
          }}
        />
      )}
    </>
  );
}

function RejectModal({ application, onClose, onDone }: { application: ApplicationCard | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!application) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/applications/${application.id}/reject`, { body: { reason } });
      setReason("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reject this application.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!application} onClose={onClose} title={`Reject ${application?.candidate.fullName ?? "candidate"}`}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Rejection is always a human decision and is recorded in the audit log with your name and reason.
        </p>
        <textarea className="input min-h-24" placeholder="Reason for rejection" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => void submit()}>
            Reject candidate
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface RankingRow {
  applicationId: string;
  stage: { id: string; name: string; color: string | null };
  candidate: { id: string; fullName: string; headline: string | null; totalExperienceYears: number | null; skills: string[]; masked?: boolean };
  match: MatchResult | null;
  effectiveScore: number | null;
}

function Ranking({ jobId, onRerun, busy }: { jobId: string; onRerun: () => void; busy: boolean }) {
  const { can } = useSession();
  const [data, setData] = useState<(Paged<RankingRow> & { unmatched: number }) | null>(null);
  const [minScore, setMinScore] = useState(0);
  const [open, setOpen] = useState<RankingRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ pageSize: "100" });
    if (minScore) params.set("minScore", String(minScore));
    return api<Paged<RankingRow> & { unmatched: number }>(`/jobs/${jobId}/ranking?${params}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [jobId, minScore]);

  useEffect(() => {
    void load();
  }, [load]);

  // Scores arrive from a background worker; poll briefly while any are missing.
  useEffect(() => {
    if (!data?.unmatched) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [data?.unmatched, load]);

  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Minimum score
          <input type="range" min={0} max={100} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
          <span className="w-8 tabular-nums">{minScore}</span>
        </label>
        {can("match:run") && (
          <button className="btn-secondary py-1.5" disabled={busy} onClick={onRerun}>
            Re-run all scores
          </button>
        )}
        {data.unmatched > 0 && (
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            {data.unmatched} candidate{data.unmatched === 1 ? "" : "s"} not scored yet — refreshing…
          </span>
        )}
      </div>

      {data.items.length === 0 ? (
        <EmptyState title="No candidates match this filter" description="Lower the minimum score or screen more candidates." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--border)", background: "var(--surface-sunken)" }}>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Candidate</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 text-right font-medium">Experience</th>
                <th className="px-4 py-2 font-medium">Missing skills</th>
                <th className="px-4 py-2 text-right font-medium">Match</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((row, i) => (
                <tr key={row.applicationId} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {i + 1}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link className="font-medium hover:underline" href={`/candidates/${row.candidate.id}`}>
                      {row.candidate.fullName}
                    </Link>
                    {row.candidate.headline && (
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {row.candidate.headline}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="chip">{row.stage.name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.candidate.totalExperienceYears != null ? `${row.candidate.totalExperienceYears} yrs` : "—"}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {row.match?.missingSkills.length ? row.match.missingSkills.join(", ") : row.match ? "None" : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <ScoreBadge score={row.effectiveScore} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {row.match && (
                      <button className="text-sm text-brand-600 hover:underline" onClick={() => setOpen(row)}>
                        Why?
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={`Match explanation — ${open?.candidate.fullName ?? ""}`} wide>
        {open?.match && (
          <MatchDetail
            match={open.match}
            onReviewed={() => {
              void load();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function JobDetails({ job }: { job: Job }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card space-y-4 p-5 lg:col-span-2">
        <div>
          <h2 className="mb-1.5 font-semibold">Description</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{job.description}</p>
        </div>
        {job.responsibilities && (
          <div>
            <h2 className="mb-1.5 font-semibold">Responsibilities</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{job.responsibilities}</p>
          </div>
        )}
      </section>

      <aside className="space-y-4">
        <section className="card p-5">
          <h2 className="mb-2 font-semibold">Requirements</h2>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Required skills
          </h3>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {job.requiredSkills.map((s) => (
              <span key={s} className="chip">
                {s}
              </span>
            ))}
          </div>
          {job.preferredSkills.length > 0 && (
            <>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Preferred skills
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {job.preferredSkills.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-2 font-semibold">At a glance</h2>
          <dl className="space-y-1.5 text-sm">
            <Row label="Experience" value={job.minExperienceYears != null ? `${job.minExperienceYears}+ years` : "Not specified"} />
            <Row label="Education" value={job.educationRequirement || "Not specified"} />
            <Row label="Openings" value={job.openings} />
            <Row
              label="Salary"
              value={job.salaryMin != null && job.salaryMax != null ? `${formatMoney(job.salaryMin, job.salaryCurrency)} – ${formatMoney(job.salaryMax, job.salaryCurrency)}` : "Not specified"}
            />
            <Row label="Expires" value={job.expiresAt ? new Date(job.expiresAt).toLocaleDateString() : "No expiry"} />
            <Row label="Published" value={job.publishedAt ? timeAgo(job.publishedAt) : "Not published"} />
          </dl>
        </section>

        {job.matchingCriteria && (
          <section className="card p-5">
            <h2 className="mb-2 font-semibold">Matching weights</h2>
            <dl className="space-y-1.5 text-sm">
              {Object.entries(job.matchingCriteria).map(([k, v]) => (
                <Row key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} value={`${v}%`} />
              ))}
            </dl>
          </section>
        )}
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
