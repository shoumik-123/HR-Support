"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { MatchDetail } from "@/components/match-detail";
import { PanelFeedback } from "@/components/panel-feedback";
import { Alert, ConfidenceBar, Modal, PageHeader, ScoreBadge, Spinner, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ApplicationFeedback, Candidate360, MatchResult, RecommendationValue } from "@/lib/types";

type Tab = "profile" | "applications" | "interviews" | "resumes" | "notes" | "activity";

export default function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AppShell>
      <Candidate id={id} />
    </AppShell>
  );
}

function Candidate({ id }: { id: string }) {
  const { can } = useSession();
  const [candidate, setCandidate] = useState<Candidate360 | null>(null);
  const [tab, setTab] = useState<Tab>("profile");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (reveal = revealed) =>
      api<Candidate360>(`/candidates/${id}${reveal ? "?reveal=true" : ""}`)
        .then(setCandidate)
        .catch((e) => setError(e.message)),
    [id, revealed],
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error && !candidate) return <Alert>{error}</Alert>;
  if (!candidate) return <Spinner />;

  const profile = candidate.profile ?? {};

  return (
    <>
      <PageHeader
        title={candidate.fullName}
        subtitle={[candidate.headline, candidate.location, candidate.totalExperienceYears != null ? `${candidate.totalExperienceYears} years experience` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            {candidate.masked && can("candidate:contact:view") && (
              <button
                className="btn-secondary"
                onClick={() => {
                  setRevealed(true);
                  void load(true);
                }}
              >
                Reveal identity
              </button>
            )}
            {can("candidate:contact:view") && !candidate.masked && (
              <a className="btn-secondary" href={`/api/candidates/${id}/export`} target="_blank" rel="noreferrer">
                Export data
              </a>
            )}
          </>
        }
      />

      {candidate.masked && <Alert kind="info">Blind recruitment mode is on. Identity and contact details are hidden; revealing them is recorded in the audit log.</Alert>}
      {candidate.missingFields.length > 0 && (
        <Alert kind="warning">
          Missing from the resume: {candidate.missingFields.join(", ")}. Verify these before relying on the profile.
        </Alert>
      )}

      <div className="my-4 flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }} role="tablist">
        {(["profile", "applications", "interviews", "resumes", "notes", "activity"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`-mb-px shrink-0 border-b-2 px-3.5 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? "border-brand-600 text-brand-600" : "border-transparent hover:text-brand-600"}`}
            style={tab === t ? undefined : { color: "var(--text-muted)" }}
            onClick={() => setTab(t)}
          >
            {t}
            {t === "applications" && candidate.applications.length > 0 && ` (${candidate.applications.length})`}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {candidate.summary && (
              <section className="card p-5">
                <h2 className="mb-2 font-semibold">Summary</h2>
                <p className="text-sm leading-relaxed">{candidate.summary}</p>
              </section>
            )}

            <EvidenceSection title="Experience" items={profile.experience?.map((e) => ({
              heading: [e.title, e.company].filter(Boolean).join(" · "),
              meta: [e.startDate, e.isCurrent ? "Present" : e.endDate].filter(Boolean).join(" – "),
              body: e.description,
              evidence: e.evidence,
              confidence: e.confidence,
            }))} />

            <EvidenceSection title="Education" items={profile.education?.map((e) => ({
              heading: [e.degree, e.field].filter(Boolean).join(" in ") || "Education",
              meta: [e.institution, e.endYear, e.grade].filter(Boolean).join(" · "),
              evidence: e.evidence,
              confidence: e.confidence,
            }))} />

            <EvidenceSection title="Projects" items={profile.projects?.map((p) => ({
              heading: p.name,
              meta: p.technologies.join(", "),
              body: p.description,
              evidence: p.evidence,
              confidence: p.confidence,
            }))} />

            <EvidenceSection title="Certifications" items={profile.certifications?.map((c) => ({
              heading: c.name,
              meta: [c.issuer, c.year].filter(Boolean).join(" · "),
              evidence: c.evidence,
              confidence: c.confidence,
            }))} />
          </div>

          <aside className="space-y-4">
            <section className="card p-5">
              <h2 className="mb-2 font-semibold">Contact</h2>
              {candidate.masked ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Hidden in blind mode.
                </p>
              ) : (
                <dl className="space-y-1.5 text-sm">
                  {candidate.email && <ContactRow label="Email" value={<a className="text-brand-600 hover:underline" href={`mailto:${candidate.email}`}>{candidate.email}</a>} />}
                  {candidate.phone && <ContactRow label="Phone" value={candidate.phone} />}
                  {candidate.linkedinUrl && <ContactRow label="LinkedIn" value={<a className="text-brand-600 hover:underline" href={candidate.linkedinUrl} target="_blank" rel="noreferrer">Profile</a>} />}
                  {candidate.githubUrl && <ContactRow label="GitHub" value={<a className="text-brand-600 hover:underline" href={candidate.githubUrl} target="_blank" rel="noreferrer">Profile</a>} />}
                  {candidate.portfolioUrl && <ContactRow label="Portfolio" value={<a className="text-brand-600 hover:underline" href={candidate.portfolioUrl} target="_blank" rel="noreferrer">Link</a>} />}
                  {!candidate.email && !candidate.phone && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No contact details found.</p>}
                </dl>
              )}
            </section>

            <section className="card p-5">
              <h2 className="mb-2 font-semibold">Skills</h2>
              <div className="flex flex-wrap gap-1.5">
                {candidate.skills.length ? candidate.skills.map((s) => <span key={s} className="chip">{s}</span>) : <span className="hint">None extracted</span>}
              </div>
              {candidate.languages.length > 0 && (
                <>
                  <h3 className="mb-1.5 mt-4 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                    Languages
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {candidate.languages.map((l) => (
                      <span key={l} className="chip">
                        {l}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="card p-5">
              <h2 className="mb-2 font-semibold">Privacy</h2>
              <dl className="space-y-1.5 text-sm">
                <ContactRow label="Consent" value={(candidate.consentStatus ?? "UNKNOWN").toLowerCase()} />
                <ContactRow label="Source" value={(candidate.source ?? "").toLowerCase().replace("_", " ")} />
              </dl>
            </section>
          </aside>
        </div>
      )}

      {tab === "applications" && <Applications candidate={candidate} onChange={() => void load()} />}
      {tab === "interviews" && <Interviews candidate={candidate} />}
      {tab === "resumes" && <Resumes candidate={candidate} />}
      {tab === "notes" && <Notes candidate={candidate} onChange={() => void load()} />}
      {tab === "activity" && <Activity candidate={candidate} />}
    </>
  );
}

function ContactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

interface EvidenceItem {
  heading: string;
  meta?: string;
  body?: string | null;
  evidence: string;
  confidence: number;
}

/** Each extracted item shows the resume snippet it came from, so claims are verifiable. */
function EvidenceSection({ title, items }: { title: string; items?: EvidenceItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!items?.length) return null;
  return (
    <section className="card p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="border-l-2 pl-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">{item.heading}</p>
              {item.confidence < 0.7 && <span className="chip text-amber-800 dark:text-amber-300">low confidence</span>}
            </div>
            {item.meta && (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {item.meta}
              </p>
            )}
            {item.body && <p className="mt-1 text-sm leading-relaxed">{item.body}</p>}
            <div className="mt-1.5 flex items-center gap-3">
              <ConfidenceBar value={item.confidence} />
              <button className="text-xs text-brand-600 hover:underline" onClick={() => setOpen(open === i ? null : i)}>
                {open === i ? "Hide source" : "Show source"}
              </button>
            </div>
            {open === i && (
              <p className="mt-1.5 rounded p-2 text-xs italic" style={{ background: "var(--surface-sunken)", color: "var(--text-muted)" }}>
                “{item.evidence}”
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Applications({ candidate, onChange }: { candidate: Candidate360; onChange: () => void }) {
  const [open, setOpen] = useState<MatchResult | null>(null);
  if (!candidate.applications.length) {
    return (
      <p className="card p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        This candidate is not on any job yet.
      </p>
    );
  }
  return (
    <>
      <ul className="space-y-3">
        {candidate.applications.map((app) => {
          const match = app.matches?.[0];
          return (
            <li key={app.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link className="font-medium hover:underline" href={`/jobs/${app.job.id}`}>
                    {app.job.title}
                  </Link>
                  <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
                    <span className="chip mr-2">{app.stage.name}</span>
                    {app.status !== "ACTIVE" && <span className="chip mr-2">{app.status.toLowerCase()}</span>}
                    applied {timeAgo(app.createdAt)}
                    {app.isReapplication && " · re-application"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ScoreBadge score={match ? match.adjustedScore ?? match.score : null} />
                  {match && (
                    <button className="btn-secondary py-1.5" onClick={() => setOpen(match)}>
                      Why?
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Match explanation" wide>
        {open && <MatchDetail match={open} onReviewed={onChange} />}
      </Modal>
    </>
  );
}

const RECOMMENDATION_LABEL: Record<RecommendationValue, string> = {
  STRONG_YES: "Strong yes", YES: "Yes", LEAN_YES: "Leaning yes", LEAN_NO: "Leaning no", NO: "No", STRONG_NO: "Strong no",
};

/** Interview history across every application this candidate has. */
function Interviews({ candidate }: { candidate: Candidate360 }) {
  const [rounds, setRounds] = useState<ApplicationFeedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!candidate.applications.length) {
      setRounds([]);
      return;
    }
    Promise.all(candidate.applications.map((a) => api<ApplicationFeedback[]>(`/applications/${a.id}/interviews`)))
      .then((lists) => setRounds(lists.flat().sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load interviews"));
  }, [candidate.applications]);

  if (error) return <Alert>{error}</Alert>;
  if (!rounds) return <Spinner />;
  if (!rounds.length) {
    return (
      <p className="card p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        No interviews have been held with this candidate yet.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {rounds.map((round) => (
        <li key={round.id} className="card p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <Link className="font-medium hover:underline" href={`/interviews/${round.id}`}>
                {round.title}
              </Link>
              <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
                Round {round.round} · {new Date(round.startsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} ·{" "}
                {round.status.replace("_", " ").toLowerCase()}
              </p>
            </div>
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              {round.panel.submitted} of {round.panel.submitted + round.panel.pending} reported
            </span>
          </div>

          {round.panel.split && <Alert kind="warning">The panel disagreed on this round — worth reading both views.</Alert>}

          {round.scorecards.filter((s) => s.submittedAt).length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No feedback submitted for this round yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {round.scorecards
                .filter((s) => s.submittedAt)
                .map((card) => (
                  <li key={card.id} className="rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{card.interviewer?.name ?? "Interviewer"}</p>
                      <span className="flex items-center gap-2">
                        {card.recommendation && <span className="chip text-xs">{RECOMMENDATION_LABEL[card.recommendation]}</span>}
                        {card.overallRating != null && <span className="text-sm font-medium tabular-nums">{card.overallRating}/5</span>}
                      </span>
                    </div>
                    {card.strengths && (
                      <p className="mt-1.5 text-sm">
                        <span className="font-medium">Strengths:</span> {card.strengths}
                      </p>
                    )}
                    {card.concerns && (
                      <p className="mt-1 text-sm">
                        <span className="font-medium">Concerns:</span> {card.concerns}
                      </p>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function Resumes({ candidate }: { candidate: Candidate360 }) {
  return (
    <ul className="space-y-3">
      {candidate.resumes.map((r) => (
        <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate font-medium">{r.fileName}</p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Version {r.version} · {r.status.toLowerCase()}
              {r.parseMethod && ` · ${r.parseMethod === "AI" ? `parsed by ${r.model ?? "AI"}` : "rule-based parsing"}`}
              {r.promptVersion && ` · ${r.promptVersion}`}
              {" · "}
              {timeAgo(r.createdAt)}
            </p>
            {r.error && <p className="mt-1 text-sm text-red-600">{r.error}</p>}
          </div>
          <div className="flex items-center gap-2">
            {r.overallConfidence != null && <ConfidenceBar value={r.overallConfidence} />}
            <a className="btn-secondary py-1.5" href={`/api/resumes/${r.id}/file`} target="_blank" rel="noreferrer">
              Download
            </a>
          </div>
        </li>
      ))}
      {!candidate.resumes.length && (
        <li className="card p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No resumes uploaded for this candidate.
        </li>
      )}
    </ul>
  );
}

function Notes({ candidate, onChange }: { candidate: Candidate360; onChange: () => void }) {
  const { can } = useSession();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api(`/candidates/${candidate.id}/notes`, { body: { body } });
      setBody("");
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {can("note:write") && (
        <div className="card space-y-2 p-4">
          {error && <Alert>{error}</Alert>}
          <textarea className="input min-h-20" placeholder="Add a note for your team…" value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn-primary" disabled={busy || body.trim().length < 1} onClick={() => void add()}>
            Add note
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {candidate.notes.map((n) => (
          <li key={n.id} className="card p-4">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{n.authorName}</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {timeAgo(n.createdAt)}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{n.body}</p>
          </li>
        ))}
        {!candidate.notes.length && (
          <li className="card p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No notes yet.
          </li>
        )}
      </ul>
    </div>
  );
}

function Activity({ candidate }: { candidate: Candidate360 }) {
  return (
    <ol className="card divide-y p-0" style={{ borderColor: "var(--border)" }}>
      {candidate.timeline.map((item) => (
        <li key={item.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm" style={{ borderColor: "var(--border)" }}>
          <span>
            <span className="font-medium">{item.action.replace(/[._]/g, " ")}</span>
            <span style={{ color: "var(--text-muted)" }}> by {item.actorName}</span>
          </span>
          <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
            {timeAgo(item.createdAt)}
          </span>
        </li>
      ))}
      {!candidate.timeline.length && (
        <li className="px-4 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No activity recorded.
        </li>
      )}
    </ol>
  );
}
