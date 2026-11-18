"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { CareersShell, employmentLabel, salaryLabel, Tag, workModeLabel } from "@/components/careers-shell";
import { Alert, Field, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { ApplicationReceipt, CareersJobPage } from "@/lib/types";

/**
 * One public advert, with the apply form beneath it. The applicant types their own
 * name and contact details: the resume is parsed afterwards to fill in the rest, but
 * it never overrules what the person said about themselves.
 */
export default function CareersJobPageRoute({ params }: { params: Promise<{ slug: string; jobId: string }> }) {
  const { slug, jobId } = use(params);
  return <JobAdvert slug={slug} jobId={jobId} />;
}

function JobAdvert({ slug, jobId }: { slug: string; jobId: string }) {
  const [page, setPage] = useState<CareersJobPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ApplicationReceipt | null>(null);

  useEffect(() => {
    api<CareersJobPage>(`/public/careers/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}`)
      .then(setPage)
      .catch((e) => setError(e instanceof ApiError ? e.message : "This vacancy could not be opened."));
  }, [slug, jobId]);

  if (error && !page) {
    return (
      <CareersShell>
        <Alert>{error}</Alert>
        <p className="mt-3 text-sm">
          <Link href={`/careers/${slug}`} className="underline">
            See the roles that are open
          </Link>
        </p>
      </CareersShell>
    );
  }
  if (!page) {
    return (
      <CareersShell>
        <Spinner label="Opening this role…" />
      </CareersShell>
    );
  }

  const { organization: org, job } = page;

  if (receipt) {
    return (
      <CareersShell org={org}>
        <Alert kind="success">Your application for {receipt.jobTitle} has been received.</Alert>
        <div className="card mt-4 p-6">
          <p className="text-sm">
            Thank you, {receipt.candidateName}. Your reference is <strong>{receipt.reference}</strong>.
          </p>
          <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
            We have sent a confirmation to {receipt.email}. The hiring team at {receipt.organizationName} reviews every
            application themselves — quote your reference if you need to get in touch about it.
          </p>
          {receipt.isReapplication && (
            <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
              We can see you have applied to {receipt.organizationName} before. Your earlier applications are unaffected.
            </p>
          )}
          <Link href={`/careers/${org.slug}`} className="btn btn-secondary mt-5 inline-block">
            See other open roles
          </Link>
        </div>
      </CareersShell>
    );
  }

  return (
    <CareersShell org={org}>
      <p className="mb-3 text-sm">
        <Link href={`/careers/${org.slug}`} className="underline" style={{ color: "var(--text-muted)" }}>
          ← All open roles
        </Link>
      </p>

      <h1 className="text-2xl font-semibold sm:text-3xl">{job.title}</h1>
      <div className="mt-3 flex flex-wrap gap-2">
        {job.department && <Tag>{job.department}</Tag>}
        {job.location && <Tag>{job.location}</Tag>}
        <Tag>{workModeLabel(job.workMode)}</Tag>
        <Tag>{employmentLabel(job.employmentType)}</Tag>
        {job.experience && <Tag>{job.experience}</Tag>}
        {job.salary && <Tag>{salaryLabel(job.salary)}</Tag>}
      </div>
      {job.closesAt && (
        <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
          Applications close on{" "}
          {new Date(job.closesAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
        </p>
      )}

      <article className="card mt-6 space-y-6 p-6">
        <Section title="About the role" body={job.description} />
        {job.responsibilities && <Section title="What you will do" body={job.responsibilities} />}
        {job.educationRequirement && <Section title="Education" body={job.educationRequirement} />}
        {job.requiredSkills.length > 0 && <Skills title="Must have" skills={job.requiredSkills} />}
        {job.preferredSkills.length > 0 && <Skills title="Nice to have" skills={job.preferredSkills} />}
      </article>

      <ApplyForm slug={slug} jobId={job.id} jobTitle={job.title} onDone={setReceipt} />
    </CareersShell>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <section>
      <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{body}</p>
    </section>
  );
}

function Skills({ title, skills }: { title: string; skills: string[] }) {
  return (
    <section>
      <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
        {title}
      </h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {skills.map((s) => (
          <Tag key={s}>{s}</Tag>
        ))}
      </div>
    </section>
  );
}

interface FormState {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  linkedinUrl: string;
  portfolioUrl: string;
  coverLetter: string;
}

const BLANK: FormState = { fullName: "", email: "", phone: "", location: "", headline: "", linkedinUrl: "", portfolioUrl: "", coverLetter: "" };

function ApplyForm({
  slug,
  jobId,
  jobTitle,
  onDone,
}: {
  slug: string;
  jobId: string;
  jobTitle: string;
  onDone: (r: ApplicationReceipt) => void;
}) {
  const [form, setForm] = useState<FormState>(BLANK);
  const [resume, setResume] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(key: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIssues({});
    if (!resume) {
      setError("Attach your resume as a PDF, DOC or DOCX file.");
      return;
    }
    if (!consent) {
      setError("Please confirm you agree to your details being stored.");
      return;
    }

    const body = new FormData();
    body.set("resume", resume);
    body.set("consent", "true");
    for (const [key, value] of Object.entries(form)) if (value.trim()) body.set(key, value.trim());

    setBusy(true);
    try {
      onDone(await api<ApplicationReceipt>(`/public/careers/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}/apply`, { form: body }));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message === "Validation failed" ? "Please check the highlighted fields." : err.message);
        setIssues(Object.fromEntries((err.issues ?? []).map((i) => [i.path, i.message])));
      } else {
        setError("Your application could not be sent. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mt-6 p-6" noValidate>
      <h2 className="text-lg font-semibold">Apply for {jobTitle}</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
        Your resume fills in the rest of your profile automatically. Fields marked with * are required.
      </p>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Full name *" error={issues.fullName}>
          <input className="input" value={form.fullName} onChange={set("fullName")} autoComplete="name" required />
        </Field>
        <Field label="Email *" error={issues.email}>
          <input className="input" type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
        </Field>
        <Field label="Phone" error={issues.phone}>
          <input className="input" value={form.phone} onChange={set("phone")} autoComplete="tel" placeholder="+8801…" />
        </Field>
        <Field label="Where you are based" error={issues.location}>
          <input className="input" value={form.location} onChange={set("location")} placeholder="Dhaka, Bangladesh" />
        </Field>
        <Field label="Current title" hint="For example: Backend Engineer at Acme" error={issues.headline}>
          <input className="input" value={form.headline} onChange={set("headline")} />
        </Field>
        <Field label="LinkedIn" error={issues.linkedinUrl}>
          <input className="input" value={form.linkedinUrl} onChange={set("linkedinUrl")} placeholder="https://linkedin.com/in/…" />
        </Field>
        <Field label="Portfolio or GitHub" error={issues.portfolioUrl}>
          <input className="input" value={form.portfolioUrl} onChange={set("portfolioUrl")} placeholder="https://…" />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Resume *" hint="PDF, DOC or DOCX" error={issues.resume}>
          <input
            ref={fileInput}
            className="input"
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setResume(e.target.files?.[0] ?? null)}
            required
          />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Anything you would like the team to know" hint="Optional, up to 5000 characters" error={issues.coverLetter}>
          <textarea className="input min-h-28" value={form.coverLetter} onChange={set("coverLetter")} maxLength={5000} />
        </Field>
      </div>

      <label className="mt-5 flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          I agree to my details and resume being stored so this employer can consider me for this role and for future
          openings. *
        </span>
      </label>

      <div className="mt-5 flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Sending…" : "Submit application"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => {
            setForm(BLANK);
            setResume(null);
            setConsent(false);
            setIssues({});
            setError(null);
            if (fileInput.current) fileInput.current.value = "";
          }}
        >
          Clear
        </button>
      </div>
    </form>
  );
}
