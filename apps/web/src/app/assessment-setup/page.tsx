"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, EmptyState, Field, Modal, PageHeader, Spinner, TagInput } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type {
  AssessmentBankQuestion,
  AssessmentKind,
  AssessmentQuestionType,
  AssessmentTemplate,
  Job,
  Paged,
  QuestionDifficulty,
} from "@/lib/types";

type Tab = "papers" | "questions";

const TYPE_LABEL: Record<AssessmentQuestionType, string> = {
  MCQ_SINGLE: "One answer",
  MCQ_MULTI: "Several answers",
  NUMERIC: "A number",
  SHORT_ANSWER: "Short written answer",
  LONG_ANSWER: "Long written answer",
};

const AUTO_MARKED: AssessmentQuestionType[] = ["MCQ_SINGLE", "MCQ_MULTI", "NUMERIC"];

const KINDS: AssessmentKind[] = ["TECHNICAL", "APTITUDE", "LOGICAL", "DOMAIN", "LANGUAGE", "MIXED"];

export default function AssessmentSetupPage() {
  return (
    <AppShell>
      <Setup />
    </AppShell>
  );
}

function Setup() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>("papers");

  return (
    <>
      <PageHeader
        title="Assessment setup"
        subtitle="Build a question bank, then assemble papers you can send to candidates"
      />

      {!can("assessment:manage") && <Alert kind="info">You can read these. Creating or editing them needs recruiter rights or above.</Alert>}

      <div className="my-4 flex gap-1 border-b" style={{ borderColor: "var(--border)" }} role="tablist">
        {([
          ["papers", "Papers"],
          ["questions", "Question bank"],
        ] as [Tab, string][]).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${tab === value ? "border-brand-600 text-brand-600" : "border-transparent hover:text-brand-600"}`}
            style={tab === value ? undefined : { color: "var(--text-muted)" }}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "papers" ? <Papers canEdit={can("assessment:manage")} /> : <QuestionBank canEdit={can("assessment:manage")} />}
    </>
  );
}

// ── Papers ──

function Papers({ canEdit }: { canEdit: boolean }) {
  const [templates, setTemplates] = useState<AssessmentTemplate[] | null>(null);
  const [questions, setQuestions] = useState<AssessmentBankQuestion[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [editing, setEditing] = useState<AssessmentTemplate | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, q, j] = await Promise.all([
        api<AssessmentTemplate[]>("/assessment-templates"),
        api<Paged<AssessmentBankQuestion>>("/assessment-questions?pageSize=200"),
        api<Paged<Job>>("/jobs?pageSize=100"),
      ]);
      setTemplates(t);
      setQuestions(q.items);
      setJobs(j.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load papers");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!templates) return <Spinner />;

  return (
    <>
      {canEdit && (
        <button className="btn-primary mb-4" onClick={() => setEditing("new")} disabled={questions.length === 0}>
          New paper
        </button>
      )}
      {questions.length === 0 && (
        <Alert kind="info">Add some questions to the bank first — a paper is assembled from them.</Alert>
      )}

      {templates.length === 0 ? (
        <EmptyState title="No papers yet" description="A paper is a set of questions with a time limit and a pass mark. You send a paper to a candidate." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => {
            const marks = t.items.reduce((sum, i) => sum + (i.points ?? i.question?.points ?? 0), 0);
            const written = t.items.filter((i) => i.question && !AUTO_MARKED.includes(i.question.type)).length;
            return (
              <article key={t.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-medium">{t.name}</h3>
                    {t.job && (
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        for {t.job.title}
                      </p>
                    )}
                  </div>
                  <span className="chip shrink-0 text-xs">{t.kind.toLowerCase()}</span>
                </div>
                {t.description && (
                  <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
                    {t.description}
                  </p>
                )}
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Mini label="Questions" value={String(t.items.length)} />
                  <Mini label="Minutes" value={String(t.durationMinutes)} />
                  <Mini label="Marks" value={String(marks)} />
                </dl>
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  Pass mark {t.passingPercent}%
                  {written > 0 && ` · ${written} written answer${written === 1 ? "" : "s"} need marking by hand`}
                  {t.shuffleQuestions && " · order randomised"}
                </p>
                {canEdit && (
                  <button className="btn-secondary mt-3 py-1.5" onClick={() => setEditing(t)}>
                    Edit
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}

      {editing && (
        <PaperEditor
          template={editing === "new" ? null : editing}
          questions={questions}
          jobs={jobs}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function PaperEditor({
  template,
  questions,
  jobs,
  onClose,
  onSaved,
}: {
  template: AssessmentTemplate | null;
  questions: AssessmentBankQuestion[];
  jobs: Job[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [kind, setKind] = useState<AssessmentKind>(template?.kind ?? "TECHNICAL");
  const [jobId, setJobId] = useState(template?.jobId ?? "");
  const [durationMinutes, setDuration] = useState(template?.durationMinutes ?? 45);
  const [passingPercent, setPassing] = useState(template?.passingPercent ?? 60);
  const [shuffle, setShuffle] = useState(template?.shuffleQuestions ?? true);
  const [showResult, setShowResult] = useState(template?.showResultToCandidate ?? false);
  const [picked, setPicked] = useState<string[]>(template?.items.map((i) => i.questionId) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const marks = picked.reduce((sum, id) => sum + (questions.find((q) => q.id === id)?.points ?? 0), 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name,
        description: description || undefined,
        kind,
        jobId: jobId || null,
        durationMinutes,
        passingPercent,
        questionIds: picked,
        shuffleQuestions: shuffle,
        showResultToCandidate: showResult,
      };
      if (template) await api(`/assessment-templates/${template.id}`, { method: "PATCH", body });
      else await api("/assessment-templates", { body });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the paper");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!template || !confirm(`Delete the paper "${template.name}"?`)) return;
    setBusy(true);
    try {
      await api(`/assessment-templates/${template.id}`, { method: "DELETE" });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete the paper");
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={template ? `Edit: ${template.name}` : "New paper"} wide>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering technical assessment" />
          </Field>
          <Field label="Type">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as AssessmentKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.charAt(0) + k.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Description" hint="Only your team sees this.">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="For a specific job">
            <select className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Any job</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Time limit (minutes)">
            <input className="input" type="number" min={5} max={480} value={durationMinutes} onChange={(e) => setDuration(Number(e.target.value))} />
          </Field>
          <Field label="Pass mark (%)" hint="Advisory — a person decides the outcome.">
            <input className="input" type="number" min={0} max={100} value={passingPercent} onChange={(e) => setPassing(Number(e.target.value))} />
          </Field>
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-1" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
            <span>
              Randomise the question order for each candidate
              <span className="mt-0.5 block hint">Makes it harder for candidates to share answers in order.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-1" checked={showResult} onChange={(e) => setShowResult(e.target.checked)} />
            <span>
              Show the candidate their score afterwards
              <span className="mt-0.5 block hint">Only once every written answer has been marked.</span>
            </span>
          </label>
        </div>

        <Field label={`Questions (${picked.length} selected, ${marks} marks)`} hint="Click to add or remove. The order here is the order on the paper.">
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
            {questions.length === 0 && <p className="p-2 text-sm hint">No questions in the bank yet.</p>}
            {questions.map((q) => {
              const index = picked.indexOf(q.id);
              const chosen = index >= 0;
              return (
                <label
                  key={q.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded p-2 text-sm hover:bg-[var(--surface-sunken)]"
                  style={chosen ? { background: "var(--surface-sunken)" } : undefined}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={chosen}
                    onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, q.id] : prev.filter((id) => id !== q.id)))}
                  />
                  <span className="min-w-0 flex-1">
                    {chosen && <span className="mr-1.5 font-medium tabular-nums">{index + 1}.</span>}
                    {q.text}
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <span className="chip text-[11px]">{TYPE_LABEL[q.type]}</span>
                      <span className="chip text-[11px]">{q.points} marks</span>
                      {!AUTO_MARKED.includes(q.type) && <span className="chip text-[11px]">marked by hand</span>}
                      {!q.approved && <span className="chip text-[11px]">draft</span>}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </Field>

        <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <button className="btn-primary" disabled={busy || !name.trim() || picked.length === 0} onClick={() => void save()}>
            {busy ? "Saving…" : template ? "Save paper" : "Create paper"}
          </button>
          {template && (
            <button className="btn-ghost text-red-600" disabled={busy} onClick={() => void remove()}>
              Delete
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Question bank ──

function QuestionBank({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<Paged<AssessmentBankQuestion> | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<AssessmentQuestionType | "">("");
  const [editing, setEditing] = useState<AssessmentBankQuestion | "new" | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ pageSize: "100" });
    if (search.trim()) params.set("search", search.trim());
    if (type) params.set("type", type);
    setError(null);
    return api<Paged<AssessmentBankQuestion>>(`/assessment-questions?${params}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load questions"));
  }, [search, type]);

  useEffect(() => {
    void load();
    api<Paged<Job>>("/jobs?pageSize=100").then((j) => setJobs(j.items)).catch(() => setJobs([]));
  }, [load]);

  if (error) return <Alert>{error}</Alert>;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search questions…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value as AssessmentQuestionType | "")}>
          <option value="">All types</option>
          {(Object.keys(TYPE_LABEL) as AssessmentQuestionType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        {canEdit && (
          <button className="btn-primary" onClick={() => setEditing("new")}>
            New question
          </button>
        )}
      </div>

      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <EmptyState
          title="No questions yet"
          description="Add questions here, then group them into a paper you can send to candidates."
          action={canEdit && <button className="btn-primary" onClick={() => setEditing("new")}>Add the first question</button>}
        />
      ) : (
        <ul className="space-y-2">
          {data.items.map((q) => (
            <li key={q.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{q.text}</p>
                {canEdit && (
                  <button className="shrink-0 text-sm text-brand-600 hover:underline" onClick={() => setEditing(q)}>
                    Edit
                  </button>
                )}
              </div>

              {(q.type === "MCQ_SINGLE" || q.type === "MCQ_MULTI") && (
                <ul className="mt-2 space-y-0.5 text-sm">
                  {q.options.map((o, i) => (
                    <li key={i} style={{ color: q.correctAnswers.includes(String(i)) ? undefined : "var(--text-muted)" }}>
                      {q.correctAnswers.includes(String(i)) ? "✓ " : "· "}
                      {o}
                    </li>
                  ))}
                </ul>
              )}
              {q.type === "NUMERIC" && (
                <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  Expected: <strong>{q.correctAnswers[0]}</strong>
                  {q.tolerance ? ` (± ${q.tolerance})` : " (exact)"}
                </p>
              )}
              {!AUTO_MARKED.includes(q.type) && (
                <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  A person marks this answer.
                </p>
              )}

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <span className="chip text-xs">{TYPE_LABEL[q.type]}</span>
                <span className="chip text-xs">{q.points} marks</span>
                <span className="chip text-xs">{q.difficulty.toLowerCase()}</span>
                {q.job && <span className="chip text-xs">{q.job.title}</span>}
                {!q.approved && <span className="chip text-xs">draft</span>}
                {q._count?.items ? <span className="chip text-xs">on {q._count.items} paper{q._count.items === 1 ? "" : "s"}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <QuestionEditor
          question={editing === "new" ? null : editing}
          jobs={jobs}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function QuestionEditor({
  question,
  jobs,
  onClose,
  onSaved,
}: {
  question: AssessmentBankQuestion | null;
  jobs: Job[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(question?.text ?? "");
  const [type, setType] = useState<AssessmentQuestionType>(question?.type ?? "MCQ_SINGLE");
  const [options, setOptions] = useState<string[]>(question?.options.length ? question.options : ["", ""]);
  const [correct, setCorrect] = useState<string[]>(question?.correctAnswers ?? []);
  const [numericAnswer, setNumericAnswer] = useState(question?.type === "NUMERIC" ? question.correctAnswers[0] ?? "" : "");
  const [tolerance, setTolerance] = useState(question?.tolerance?.toString() ?? "");
  const [points, setPoints] = useState(question?.points ?? 1);
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>(question?.difficulty ?? "MEDIUM");
  const [skills, setSkills] = useState<string[]>(question?.skills ?? []);
  const [jobId, setJobId] = useState(question?.jobId ?? "");
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isMcq = type === "MCQ_SINGLE" || type === "MCQ_MULTI";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        text,
        type,
        difficulty,
        points,
        skills,
        jobId: jobId || null,
        explanation: explanation || null,
        options: isMcq ? options.map((o) => o.trim()).filter(Boolean) : [],
        correctAnswers: isMcq ? correct : type === "NUMERIC" ? [numericAnswer] : [],
        tolerance: type === "NUMERIC" && tolerance ? Number(tolerance) : null,
      };
      if (question) await api(`/assessment-questions/${question.id}`, { method: "PATCH", body });
      else await api("/assessment-questions", { body });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the question");
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!question || !confirm("Archive this question? Papers already sent keep their copy.")) return;
    setBusy(true);
    try {
      await api(`/assessment-questions/${question.id}`, { method: "DELETE" });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not archive");
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={question ? "Edit question" : "New question"} wide>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <Field label="The question">
          <textarea className="input min-h-20" value={text} onChange={(e) => setText(e.target.value)} placeholder="What does a database index do?" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Answer type">
            <select
              className="input"
              value={type}
              onChange={(e) => {
                setType(e.target.value as AssessmentQuestionType);
                setCorrect([]);
              }}
            >
              {(Object.keys(TYPE_LABEL) as AssessmentQuestionType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Marks">
            <input className="input" type="number" min={1} max={100} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
          </Field>
          <Field label="Difficulty">
            <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as QuestionDifficulty)}>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
          </Field>
        </div>

        {isMcq && (
          <Field
            label="Options"
            hint={type === "MCQ_SINGLE" ? "Tick the one correct option." : "Tick every correct option. Candidates get the marks only if they pick exactly these."}
          >
            <div className="space-y-1.5">
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type={type === "MCQ_SINGLE" ? "radio" : "checkbox"}
                    name="correct"
                    checked={correct.includes(String(i))}
                    onChange={(e) => {
                      const v = String(i);
                      if (type === "MCQ_SINGLE") setCorrect([v]);
                      else setCorrect((prev) => (e.target.checked ? [...prev, v] : prev.filter((x) => x !== v)));
                    }}
                    aria-label={`Option ${i + 1} is correct`}
                  />
                  <input
                    className="input flex-1"
                    value={o}
                    onChange={(e) => setOptions(options.map((x, j) => (i === j ? e.target.value : x)))}
                    placeholder={`Option ${i + 1}`}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      className="btn-ghost px-2"
                      onClick={() => {
                        setOptions(options.filter((_, j) => j !== i));
                        setCorrect(correct.filter((c) => c !== String(i)));
                      }}
                      aria-label={`Remove option ${i + 1}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {options.length < 10 && (
                <button type="button" className="btn-secondary py-1.5 text-sm" onClick={() => setOptions([...options, ""])}>
                  Add an option
                </button>
              )}
            </div>
          </Field>
        )}

        {type === "NUMERIC" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Correct answer">
              <input className="input" type="number" step="any" value={numericAnswer} onChange={(e) => setNumericAnswer(e.target.value)} />
            </Field>
            <Field label="Tolerance" hint="How far off is still accepted. Leave empty for an exact match.">
              <input className="input" type="number" step="any" min={0} value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
            </Field>
          </div>
        )}

        {!isMcq && type !== "NUMERIC" && (
          <Alert kind="info">A person marks this answer after the candidate submits. No answer key is needed.</Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Skills this tests">
            <TagInput value={skills} onChange={setSkills} placeholder="e.g. PostgreSQL" />
          </Field>
          <Field label="For a specific job">
            <select className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Any job</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Explanation" hint="Internal note on why the answer is right. Never shown during the test.">
          <input className="input" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </Field>

        <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <button className="btn-primary" disabled={busy || text.trim().length < 5} onClick={() => void save()}>
            {busy ? "Saving…" : question ? "Save question" : "Add question"}
          </button>
          {question && (
            <button className="btn-ghost text-red-600" disabled={busy} onClick={() => void archive()}>
              Archive
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-2" style={{ background: "var(--surface-sunken)" }}>
      <dd className="font-semibold tabular-nums">{value}</dd>
      <dt className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
    </div>
  );
}
