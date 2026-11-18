"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Field, Modal, TagInput } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Department, Job, MatchingCriteria } from "@/lib/types";

const DEFAULT_CRITERIA: MatchingCriteria = { skills: 45, experience: 25, education: 10, projects: 10, certifications: 10 };

type FormState = {
  title: string;
  departmentId: string;
  description: string;
  responsibilities: string;
  location: string;
  workMode: Job["workMode"];
  employmentType: Job["employmentType"];
  requiredSkills: string[];
  preferredSkills: string[];
  minExperienceYears: string;
  maxExperienceYears: string;
  educationRequirement: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  salaryVisible: boolean;
  openings: string;
  expiresAt: string;
  matchingCriteria: MatchingCriteria;
};

function initial(job?: Job): FormState {
  return {
    title: job?.title ?? "",
    departmentId: job?.departmentId ?? "",
    description: job?.description ?? "",
    responsibilities: job?.responsibilities ?? "",
    location: job?.location ?? "",
    workMode: job?.workMode ?? "ONSITE",
    employmentType: job?.employmentType ?? "FULL_TIME",
    requiredSkills: job?.requiredSkills ?? [],
    preferredSkills: job?.preferredSkills ?? [],
    minExperienceYears: job?.minExperienceYears?.toString() ?? "",
    maxExperienceYears: job?.maxExperienceYears?.toString() ?? "",
    educationRequirement: job?.educationRequirement ?? "",
    salaryMin: job?.salaryMin?.toString() ?? "",
    salaryMax: job?.salaryMax?.toString() ?? "",
    salaryCurrency: job?.salaryCurrency ?? "BDT",
    salaryVisible: job?.salaryVisible ?? false,
    openings: job?.openings?.toString() ?? "1",
    expiresAt: job?.expiresAt ? job.expiresAt.slice(0, 10) : "",
    matchingCriteria: job?.matchingCriteria ?? DEFAULT_CRITERIA,
  };
}

export function JobForm({ job }: { job?: Job }) {
  const router = useRouter();
  const { can } = useSession();
  const [form, setForm] = useState<FormState>(() => initial(job));
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    api<Department[]>("/org/departments").then(setDepartments).catch(() => setDepartments([]));
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const weightTotal = Object.values(form.matchingCriteria).reduce((a, b) => a + b, 0);

  async function save(publish: boolean) {
    setBusy(true);
    setError(null);
    setIssues({});
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    const body = {
      title: form.title,
      departmentId: form.departmentId || null,
      description: form.description,
      responsibilities: form.responsibilities || null,
      location: form.location || null,
      workMode: form.workMode,
      employmentType: form.employmentType,
      requiredSkills: form.requiredSkills,
      preferredSkills: form.preferredSkills,
      minExperienceYears: num(form.minExperienceYears),
      maxExperienceYears: num(form.maxExperienceYears),
      educationRequirement: form.educationRequirement || null,
      salaryMin: num(form.salaryMin),
      salaryMax: num(form.salaryMax),
      salaryCurrency: form.salaryCurrency,
      salaryVisible: form.salaryVisible,
      openings: Number(form.openings || 1),
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      matchingCriteria: form.matchingCriteria,
    };

    try {
      const saved = job ? await api<Job>(`/jobs/${job.id}`, { method: "PATCH", body }) : await api<Job>("/jobs", { body });
      if (publish) await api(`/jobs/${saved.id}/publish`, { method: "POST" });
      router.push(`/jobs/${saved.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.issues) setIssues(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      } else setError("Could not save the job.");
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      {error && <Alert>{error}</Alert>}

      <section className="card space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-semibold">Role</h2>
          {can("ai:use") && (
            <button type="button" className="btn-secondary py-1.5" onClick={() => setAiOpen(true)}>
              ✨ Draft with AI
            </button>
          )}
        </div>

        <Field label="Job title" error={issues.title}>
          <input className="input" required value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Senior Full Stack Engineer" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department">
            <select className="input" value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
              <option value="">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <input className="input" value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Dhaka, Bangladesh" />
          </Field>
          <Field label="Work mode">
            <select className="input" value={form.workMode} onChange={(e) => set("workMode", e.target.value as Job["workMode"])}>
              <option value="ONSITE">On-site</option>
              <option value="HYBRID">Hybrid</option>
              <option value="REMOTE">Remote</option>
            </select>
          </Field>
          <Field label="Employment type">
            <select className="input" value={form.employmentType} onChange={(e) => set("employmentType", e.target.value as Job["employmentType"])}>
              <option value="FULL_TIME">Full time</option>
              <option value="PART_TIME">Part time</option>
              <option value="CONTRACT">Contract</option>
              <option value="INTERNSHIP">Internship</option>
              <option value="TEMPORARY">Temporary</option>
            </select>
          </Field>
        </div>

        <Field label="Description" hint="Shown to candidates and used by AI matching." error={issues.description}>
          <textarea className="input min-h-40" required value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label="Responsibilities" hint="Optional. Markdown bullet list works well.">
          <textarea className="input min-h-24" value={form.responsibilities} onChange={(e) => set("responsibilities", e.target.value)} />
        </Field>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Requirements</h2>
        <Field label="Required skills" hint="Candidates are matched against these first.">
          <TagInput value={form.requiredSkills} onChange={(v) => set("requiredSkills", v)} placeholder="Type a skill and press Enter" />
        </Field>
        <Field label="Preferred skills" hint="Nice to have; weighted lower than required skills.">
          <TagInput value={form.preferredSkills} onChange={(v) => set("preferredSkills", v)} placeholder="Type a skill and press Enter" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum experience (years)">
            <input className="input" type="number" min={0} max={60} value={form.minExperienceYears} onChange={(e) => set("minExperienceYears", e.target.value)} />
          </Field>
          <Field label="Maximum experience (years)" hint="Candidates above this are not penalised.">
            <input className="input" type="number" min={0} max={60} value={form.maxExperienceYears} onChange={(e) => set("maxExperienceYears", e.target.value)} />
          </Field>
          <Field label="Openings">
            <input className="input" type="number" min={1} value={form.openings} onChange={(e) => set("openings", e.target.value)} />
          </Field>
        </div>
        <Field label="Education requirement">
          <input className="input" value={form.educationRequirement} onChange={(e) => set("educationRequirement", e.target.value)} placeholder="Bachelor's degree in Computer Science or equivalent" />
        </Field>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Compensation & expiry</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Salary from">
            <input className="input" type="number" min={0} value={form.salaryMin} onChange={(e) => set("salaryMin", e.target.value)} />
          </Field>
          <Field label="Salary to">
            <input className="input" type="number" min={0} value={form.salaryMax} onChange={(e) => set("salaryMax", e.target.value)} />
          </Field>
          <Field label="Currency">
            <input className="input" maxLength={3} value={form.salaryCurrency} onChange={(e) => set("salaryCurrency", e.target.value.toUpperCase())} />
          </Field>
          <Field label="Job expires on">
            <input className="input" type="date" value={form.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.salaryVisible} onChange={(e) => set("salaryVisible", e.target.checked)} />
          Show the salary range on the public job posting
        </label>
      </section>

      <section className="card space-y-3 p-5">
        <div>
          <h2 className="font-semibold">Matching weights</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            How much each criterion counts toward the overall match score. Criteria the job doesn&apos;t specify are skipped and their weight is shared out.
          </p>
        </div>
        {(Object.keys(form.matchingCriteria) as (keyof MatchingCriteria)[]).map((key) => (
          <div key={key} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3">
            <label className="text-sm capitalize" htmlFor={`w-${key}`}>
              {key}
            </label>
            <input
              id={`w-${key}`}
              type="range"
              min={0}
              max={100}
              step={5}
              value={form.matchingCriteria[key]}
              onChange={(e) => set("matchingCriteria", { ...form.matchingCriteria, [key]: Number(e.target.value) })}
            />
            <span className="text-right text-sm tabular-nums">{form.matchingCriteria[key]}%</span>
          </div>
        ))}
        <p className={`text-sm ${weightTotal === 100 ? "" : "text-red-600"}`}>
          Total: {weightTotal}% {weightTotal === 100 ? "" : "— weights must add up to 100%"}
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-secondary" disabled={busy || weightTotal !== 100}>
          {job ? "Save changes" : "Save as draft"}
        </button>
        {can("job:publish") && (
          <button type="button" className="btn-primary" disabled={busy || weightTotal !== 100} onClick={() => void save(true)}>
            {job?.status === "PUBLISHED" ? "Save and keep published" : "Save and publish"}
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={() => router.back()}>
          Cancel
        </button>
      </div>

      <AiDraftModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        title={form.title}
        onApply={(draft) =>
          setForm((f) => ({
            ...f,
            description: draft.description,
            responsibilities: draft.responsibilities,
            requiredSkills: [...new Set([...f.requiredSkills, ...draft.requiredSkills])],
            preferredSkills: [...new Set([...f.preferredSkills, ...draft.preferredSkills])],
            educationRequirement: f.educationRequirement || draft.educationRequirement,
          }))
        }
      />
    </form>
  );
}

interface GeneratedJob {
  description: string;
  responsibilities: string;
  requiredSkills: string[];
  preferredSkills: string[];
  educationRequirement: string;
  model: string;
}

function AiDraftModal({ open, onClose, title, onApply }: { open: boolean; onClose: () => void; title: string; onApply: (draft: GeneratedJob) => void }) {
  const [input, setInput] = useState({ title, seniority: "", context: "" });
  const [draft, setDraft] = useState<GeneratedJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setInput((i) => ({ ...i, title: title || i.title }));
  }, [open, title]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setDraft(await api<GeneratedJob>("/jobs/ai/generate-description", { body: { title: input.title, seniority: input.seniority || undefined, context: input.context || undefined } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate a draft.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Draft a job description with AI" wide>
      {error && <Alert>{error}</Alert>}
      {!draft ? (
        <div className="space-y-4">
          <Field label="Job title">
            <input className="input" value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })} />
          </Field>
          <Field label="Seniority">
            <input className="input" value={input.seniority} onChange={(e) => setInput({ ...input, seniority: e.target.value })} placeholder="Mid-level, Senior, Lead…" />
          </Field>
          <Field label="Anything specific to include?" hint="Team, product, tech stack, must-have experience.">
            <textarea className="input min-h-24" value={input.context} onChange={(e) => setInput({ ...input, context: e.target.value })} />
          </Field>
          <p className="hint">The draft is a starting point. Review and edit it before publishing — you stay responsible for the wording.</p>
          <button className="btn-primary w-full" onClick={() => void generate()} disabled={busy || input.title.trim().length < 2}>
            {busy ? "Writing a draft…" : "Generate draft"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="mb-1 text-sm font-medium">Description</h3>
            <p className="whitespace-pre-wrap rounded-lg p-3 text-sm" style={{ background: "var(--surface-sunken)" }}>
              {draft.description}
            </p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">Responsibilities</h3>
            <p className="whitespace-pre-wrap rounded-lg p-3 text-sm" style={{ background: "var(--surface-sunken)" }}>
              {draft.responsibilities}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {draft.requiredSkills.map((s) => (
              <span key={s} className="chip">
                {s}
              </span>
            ))}
          </div>
          <p className="hint">Generated by {draft.model}. Edit freely after applying.</p>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              onClick={() => {
                onApply(draft);
                setDraft(null);
                onClose();
              }}
            >
              Apply to the form
            </button>
            <button className="btn-secondary" onClick={() => setDraft(null)}>
              Try again
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
