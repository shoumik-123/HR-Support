"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, EmptyState, Field, Modal, PageHeader, ScoreBadge, Spinner, TagInput, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Job, Paged, SavedSearch, TalentCriteria, TalentHit, TalentSearchResult } from "@/lib/types";

const EXAMPLES = [
  "3+ years React developer in Dhaka, preferably Node.js",
  "Python engineer with a master's degree",
  "Accountant in Chattogram, 2-5 years, Excel",
  "Senior UI designer, Figma, no WordPress",
];

const EMPTY_CRITERIA: TalentCriteria = {
  requiredSkills: [],
  preferredSkills: [],
  excludedSkills: [],
  minExperienceYears: null,
  maxExperienceYears: null,
  locations: [],
  titles: [],
  keywords: [],
  education: null,
  tags: [],
};

const METHOD_LABEL: Record<TalentSearchResult["method"], string> = {
  AI: "Read by AI",
  HEURISTIC: "Read by rules",
  MANUAL: "Searched as given",
};

export default function TalentSearchPage() {
  return (
    <AppShell>
      <TalentSearch />
    </AppShell>
  );
}

function TalentSearch() {
  const { can } = useSession();
  const [phrase, setPhrase] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<TalentSearchResult | null>(null);
  const [criteria, setCriteria] = useState<TalentCriteria | null>(null);
  const [edited, setEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);

  const loadSaved = useCallback(() => {
    api<SavedSearch[]>("/talent/searches")
      .then(setSaved)
      .catch(() => setSaved([]));
  }, []);

  useEffect(loadSaved, [loadSaved]);

  /** `useCriteria` searches the criteria on screen; otherwise the phrase is read afresh. */
  const run = useCallback(
    async (nextPage: number, useCriteria: TalentCriteria | null) => {
      setLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { phrase, page: nextPage, pageSize: 10 };
        if (useCriteria) body.criteria = useCriteria;
        const data = await api<TalentSearchResult>("/talent/search", { body });
        setResult(data);
        setCriteria(stripRead(data.query));
        setEdited(false);
        setPage(nextPage);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Search failed");
      } finally {
        setLoading(false);
      }
    },
    [phrase],
  );

  async function runSaved(search: SavedSearch) {
    setLoading(true);
    setError(null);
    try {
      const data = await api<TalentSearchResult>(`/talent/searches/${search.id}/run`, { body: { page: 1, pageSize: 10 } });
      setPhrase(search.phrase);
      setResult(data);
      setCriteria(stripRead(data.query));
      setEdited(false);
      setPage(1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not run that saved search");
    } finally {
      setLoading(false);
    }
  }

  async function removeSaved(id: string) {
    await api(`/talent/searches/${id}`, { method: "DELETE" }).catch(() => undefined);
    loadSaved();
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Smart search"
        subtitle="Describe who you are looking for in your own words. Every result shows why it is there."
      />

      <form
        className="card mb-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(1, null);
        }}
      >
        <label className="label" htmlFor="phrase">
          Who are you looking for?
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="phrase"
            className="input"
            placeholder="e.g. 3+ years React developer in Dhaka, preferably Node.js"
            value={phrase}
            maxLength={500}
            onChange={(e) => setPhrase(e.target.value)}
          />
          <button className="btn-primary shrink-0" type="submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Try:
          </span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => setPhrase(ex)}>
              {ex}
            </button>
          ))}
        </div>

        {saved.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Saved:
            </span>
            {saved.map((s) => (
              <span key={s.id} className="chip flex items-center gap-1">
                <button type="button" onClick={() => void runSaved(s)} title={s.phrase}>
                  {s.name}
                </button>
                <button type="button" aria-label={`Delete saved search ${s.name}`} onClick={() => void removeSaved(s.id)} style={{ color: "var(--text-muted)" }}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </form>

      {error && <Alert>{error}</Alert>}
      {loading && !result && <Spinner label="Searching your talent pool…" />}

      {result && criteria && (
        <>
          <Interpretation
            result={result}
            criteria={criteria}
            edited={edited}
            onChange={(next) => {
              setCriteria(next);
              setEdited(true);
            }}
            onRerun={() => void run(1, criteria)}
            onSave={() => setSaveOpen(true)}
          />

          {result.items.length === 0 ? (
            <EmptyState
              title="Nobody in the pool matches that"
              description="Try fewer requirements, or widen the experience range. Correcting the criteria above and searching again is often enough."
            />
          ) : (
            <div className="grid gap-3">
              {result.items.map((hit) => (
                <HitCard key={hit.candidate.id} hit={hit} ranked={result.ranked} canAdd={can("candidate:manage")} />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button className="btn-secondary py-1.5" disabled={page === 1 || loading} onClick={() => void run(page - 1, edited ? criteria : null)}>
                Previous
              </button>
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                Page {page} of {totalPages}
              </span>
              <button className="btn-secondary py-1.5" disabled={page >= totalPages || loading} onClick={() => void run(page + 1, edited ? criteria : null)}>
                Next
              </button>
            </div>
          )}

          <SaveSearchModal
            open={saveOpen}
            phrase={phrase}
            criteria={criteria}
            onClose={() => setSaveOpen(false)}
            onSaved={() => {
              setSaveOpen(false);
              loadSaved();
            }}
          />
        </>
      )}
    </>
  );
}

function stripRead(query: TalentSearchResult["query"]): TalentCriteria {
  const { requiredSkills, preferredSkills, excludedSkills, minExperienceYears, maxExperienceYears, locations, titles, keywords, education, tags } = query;
  return { ...EMPTY_CRITERIA, requiredSkills, preferredSkills, excludedSkills, minExperienceYears, maxExperienceYears, locations, titles, keywords, education, tags };
}

/** How the search was read, and the chance to correct it before trusting the list. */
function Interpretation({
  result,
  criteria,
  edited,
  onChange,
  onRerun,
  onSave,
}: {
  result: TalentSearchResult;
  criteria: TalentCriteria;
  edited: boolean;
  onChange: (next: TalentCriteria) => void;
  onRerun: () => void;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<TalentCriteria>) => onChange({ ...criteria, ...patch });

  return (
    <div className="card mb-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm">{result.query.interpretation}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {METHOD_LABEL[result.method]}
            {result.model ? ` · ${result.model}` : ""} · {Math.round(result.query.confidence * 100)}% sure this is what you meant · {result.total} of{" "}
            {result.poolSearched} candidates read
            {result.excludedCount > 0 ? ` · ${result.excludedCount} left out by your exclusions` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn-secondary py-1.5" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide criteria" : "Correct criteria"}
          </button>
          <button className="btn-secondary py-1.5" onClick={onSave}>
            Save search
          </button>
        </div>
      </div>

      {result.fallbackReason && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          AI could not read the phrase ({result.fallbackReason}), so the rules read it instead.
        </p>
      )}
      {result.unclear.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Not used in the search: {result.unclear.join("; ")}
        </p>
      )}
      {result.poolTruncated && (
        <Alert kind="warning">
          This search read the {result.poolSearched} most recently updated of {result.poolTotal} matching candidates. Add a skill or a location to narrow it.
        </Alert>
      )}
      {result.blindMode && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Blind mode is on: names and contact details are hidden, and resumes are searched with identity removed.
        </p>
      )}

      {open && (
        <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2" style={{ borderColor: "var(--border)" }}>
          <Field label="Must show">
            <TagInput value={criteria.requiredSkills} onChange={(v) => set({ requiredSkills: v })} placeholder="e.g. React" />
          </Field>
          <Field label="Nice to have">
            <TagInput value={criteria.preferredSkills} onChange={(v) => set({ preferredSkills: v })} placeholder="e.g. Docker" />
          </Field>
          <Field label="Leave out anyone with">
            <TagInput value={criteria.excludedSkills} onChange={(v) => set({ excludedSkills: v })} placeholder="e.g. WordPress" />
          </Field>
          <Field label="Role">
            <TagInput value={criteria.titles} onChange={(v) => set({ titles: v })} placeholder="e.g. frontend developer" />
          </Field>
          <Field label="Location">
            <TagInput value={criteria.locations} onChange={(v) => set({ locations: v })} placeholder="e.g. Dhaka" />
          </Field>
          <Field label="Other terms">
            <TagInput value={criteria.keywords} onChange={(v) => set({ keywords: v })} placeholder="e.g. fintech" />
          </Field>
          <Field label="Years of experience" hint="Someone a little short still appears, lower down.">
            <div className="flex items-center gap-2">
              <input
                className="input w-24"
                type="number"
                min={0}
                max={60}
                value={criteria.minExperienceYears ?? ""}
                aria-label="Minimum years"
                onChange={(e) => set({ minExperienceYears: e.target.value === "" ? null : Number(e.target.value) })}
              />
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                to
              </span>
              <input
                className="input w-24"
                type="number"
                min={0}
                max={60}
                value={criteria.maxExperienceYears ?? ""}
                aria-label="Maximum years"
                onChange={(e) => set({ maxExperienceYears: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </div>
          </Field>
          <Field label="Minimum qualification">
            <input
              className="input"
              value={criteria.education ?? ""}
              placeholder="e.g. Bachelor's degree"
              maxLength={80}
              onChange={(e) => set({ education: e.target.value || null })}
            />
          </Field>
          <div className="sm:col-span-2">
            <button className="btn-primary" onClick={onRerun} disabled={!edited}>
              {edited ? "Search again with these criteria" : "Criteria match the search above"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HitCard({ hit, ranked, canAdd }: { hit: TalentHit; ranked: boolean; canAdd: boolean }) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const c = hit.candidate;

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/candidates/${c.id}`} className="font-medium hover:underline">
              {c.fullName}
            </Link>
            {c.totalExperienceYears != null && <span className="chip">{c.totalExperienceYears} yrs</span>}
            {c.location && <span className="chip">{c.location}</span>}
          </div>
          {c.headline && (
            <p className="mt-0.5 truncate text-sm" style={{ color: "var(--text-muted)" }}>
              {c.headline}
            </p>
          )}
        </div>
        {ranked && <ScoreBadge score={hit.score} />}
      </div>

      {hit.reasons.length > 0 && (
        <ul className="mt-2.5 grid gap-1 text-sm">
          {hit.reasons.map((r) => (
            <li key={r}>✓ {r}</li>
          ))}
        </ul>
      )}
      {hit.gaps.length > 0 && (
        <ul className="mt-1 grid gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {hit.gaps.map((g) => (
            <li key={g}>· {g}</li>
          ))}
        </ul>
      )}

      {hit.pipelines.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Already in: {hit.pipelines.map((p) => `${p.jobTitle} (${p.stageName})`).join(", ")}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-xs" style={{ borderColor: "var(--border)" }}>
        <span style={{ color: "var(--text-muted)" }}>
          Confidence in this reading: {Math.round(hit.confidence * 100)}% · updated {timeAgo(c.updatedAt)}
        </span>
        <div className="flex gap-2">
          {ranked && (
            <button className="btn-ghost px-2 py-1" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide the maths" : "Why this score"}
            </button>
          )}
          {canAdd && (
            <button className="btn-secondary px-2 py-1" onClick={() => setAddOpen(true)}>
              Add to a job
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 grid gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          {hit.breakdown.map((b) => (
            <div key={b.criterion}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium capitalize">{b.criterion}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {b.score == null ? "not part of this search" : `${b.score}/100 · weight ${b.weight}%`}
                </span>
              </div>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {b.rationale}
              </p>
              {b.evidence.map((e) => (
                <p key={e} className="mt-1 border-l-2 pl-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                  “{e}”
                </p>
              ))}
            </div>
          ))}
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            The score is a weighted average of the rows above, computed here — not a number from a model. It ranks a list; it decides nothing.
          </p>
        </div>
      )}

      <AddToJobModal open={addOpen} candidateId={c.id} candidateName={c.fullName} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function SaveSearchModal({
  open,
  phrase,
  criteria,
  onClose,
  onSaved,
}: {
  open: boolean;
  phrase: string;
  criteria: TalentCriteria;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/talent/searches", { body: { name: name.trim(), phrase, criteria } });
      setName("");
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Save this search">
      {error && <Alert>{error}</Alert>}
      <Field label="Name it" hint="Saved searches are yours alone; nobody else in the organization sees them.">
        <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. React, Dhaka, 3 years" />
      </Field>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        The criteria on screen are saved with it, so re-running it searches for the same thing even if the phrase would be read differently later.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={() => void submit()} disabled={busy || !name.trim()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function AddToJobModal({ open, candidateId, candidateName, onClose }: { open: boolean; candidateId: string; candidateName: string; onClose: () => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || jobs) return;
    api<Paged<Job>>("/jobs?pageSize=100")
      .then((d) => setJobs(d.items))
      .catch(() => setJobs([]));
  }, [open, jobs]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/applications", { body: { jobId, candidateId, source: "OTHER" } });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add them");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add ${candidateName} to a job`}>
      {error && <Alert>{error}</Alert>}
      {done ? (
        <>
          <Alert kind="success">Added to the first stage of the pipeline. Run screening from the job to score the match.</Alert>
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          {!jobs ? (
            <Spinner />
          ) : (
            <Field label="Which job?">
              <select className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">Choose a job…</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={() => void submit()} disabled={busy || !jobId}>
              {busy ? "Adding…" : "Add to pipeline"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
