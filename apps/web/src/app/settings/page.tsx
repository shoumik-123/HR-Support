"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, Field, PageHeader, Spinner, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Department, Organization, Stage } from "@/lib/types";

type Tab = "organization" | "pipeline" | "departments" | "audit";

export default function SettingsPage() {
  return (
    <AppShell>
      <Settings />
    </AppShell>
  );
}

function Settings() {
  const { can } = useSession();
  const tabs: Tab[] = ["organization", "pipeline", "departments", ...(can("audit:view") ? (["audit"] as Tab[]) : [])];
  const [tab, setTab] = useState<Tab>("organization");

  return (
    <>
      <PageHeader title="Settings" subtitle="Organization profile, hiring pipeline and audit trail" />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }} role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`-mb-px shrink-0 border-b-2 px-3.5 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? "border-brand-600 text-brand-600" : "border-transparent hover:text-brand-600"}`}
            style={tab === t ? undefined : { color: "var(--text-muted)" }}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "organization" && <OrgSettings />}
      {tab === "pipeline" && <PipelineSettings />}
      {tab === "departments" && <DepartmentSettings />}
      {tab === "audit" && <AuditLog />}
    </>
  );
}

function OrgSettings() {
  const { can, refreshMe } = useSession();
  const [org, setOrg] = useState<Organization | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const editable = can("org:manage");

  useEffect(() => {
    api<Organization>("/org").then(setOrg).catch((e) => setError(e.message));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/org", {
        method: "PATCH",
        body: {
          name: org.name,
          website: org.website || null,
          industry: org.industry || null,
          companySize: org.companySize || null,
          country: org.country || null,
          timezone: org.timezone,
          defaultCurrency: org.defaultCurrency,
          blindModeDefault: org.blindModeDefault,
        },
      });
      setSaved(true);
      await refreshMe();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !org) return <Alert>{error}</Alert>;
  if (!org) return <Spinner />;

  return (
    <form className="card max-w-2xl space-y-4 p-5" onSubmit={save}>
      {error && <Alert>{error}</Alert>}
      {saved && <Alert kind="success">Settings saved.</Alert>}

      <Field label="Organization name">
        <input className="input" value={org.name} disabled={!editable} onChange={(e) => setOrg({ ...org, name: e.target.value })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Industry">
          <input className="input" value={org.industry ?? ""} disabled={!editable} onChange={(e) => setOrg({ ...org, industry: e.target.value })} />
        </Field>
        <Field label="Company size">
          <input className="input" value={org.companySize ?? ""} disabled={!editable} onChange={(e) => setOrg({ ...org, companySize: e.target.value })} placeholder="51-200" />
        </Field>
        <Field label="Website">
          <input className="input" type="url" value={org.website ?? ""} disabled={!editable} onChange={(e) => setOrg({ ...org, website: e.target.value })} placeholder="https://example.com" />
        </Field>
        <Field label="Country">
          <input className="input" value={org.country ?? ""} disabled={!editable} onChange={(e) => setOrg({ ...org, country: e.target.value })} />
        </Field>
        <Field label="Timezone">
          <input className="input" value={org.timezone} disabled={!editable} onChange={(e) => setOrg({ ...org, timezone: e.target.value })} />
        </Field>
        <Field label="Default currency">
          <input className="input" maxLength={3} value={org.defaultCurrency} disabled={!editable} onChange={(e) => setOrg({ ...org, defaultCurrency: e.target.value.toUpperCase() })} />
        </Field>
      </div>

      <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={org.blindModeDefault} disabled={!editable} onChange={(e) => setOrg({ ...org, blindModeDefault: e.target.checked })} />
          <span>
            <span className="font-medium">Blind recruitment mode</span>
            <span className="mt-0.5 block text-sm" style={{ color: "var(--text-muted)" }}>
              Hide candidate names and contact details across the app so reviewers judge qualifications first. Authorised members can reveal an individual candidate, and each
              reveal is recorded in the audit log. Identity is excluded from AI matching whether or not this is on.
            </span>
          </span>
        </label>
      </div>

      {editable && (
        <button className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
      )}
    </form>
  );
}

function PipelineSettings() {
  const { can } = useSession();
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const editable = can("pipeline:configure");

  const load = useCallback(() => api<Stage[]>("/org/stages").then(setStages).catch((e) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update the pipeline");
    }
  }

  if (error && !stages) return <Alert>{error}</Alert>;
  if (!stages) return <Spinner />;

  return (
    <div className="max-w-2xl space-y-4">
      {error && <Alert>{error}</Alert>}
      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Recruitment stages</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--text-muted)" }}>
          Candidates move through these stages. Applied, Hired and Rejected are required and cannot be removed.
        </p>
        <ol className="space-y-2">
          {stages.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: "var(--surface-sunken)" }}>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color ?? "var(--chart-series-1)" }} />
              <span className="flex-1 text-sm font-medium">{s.name}</span>
              {["APPLIED", "HIRED", "REJECTED"].includes(s.kind) ? (
                <span className="chip">required</span>
              ) : (
                editable && (
                  <>
                    <button
                      className="btn-ghost px-2 py-1 text-xs"
                      disabled={i === 0}
                      onClick={() =>
                        void run(() =>
                          api("/org/stages/order", {
                            method: "PUT",
                            body: { ids: stages.map((x) => x.id).map((id, idx, arr) => (idx === i - 1 ? arr[i] : idx === i ? arr[i - 1] : id)) },
                          }),
                        )
                      }
                      aria-label={`Move ${s.name} earlier`}
                    >
                      ↑
                    </button>
                    <button className="text-xs text-red-600 hover:underline" onClick={() => void run(() => api(`/org/stages/${s.id}`, { method: "DELETE" }))}>
                      Delete
                    </button>
                  </>
                )
              )}
            </li>
          ))}
        </ol>

        {editable && (
          <div className="mt-4 flex gap-2">
            <input className="input" placeholder="New stage name" value={name} onChange={(e) => setName(e.target.value)} />
            <button
              className="btn-secondary"
              disabled={name.trim().length < 1}
              onClick={() =>
                void run(async () => {
                  await api("/org/stages", { body: { name: name.trim() } });
                  setName("");
                })
              }
            >
              Add stage
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function DepartmentSettings() {
  const { can } = useSession();
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const editable = can("org:manage");

  const load = useCallback(() => api<Department[]>("/org/departments").then(setDepartments).catch((e) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load]);

  if (error && !departments) return <Alert>{error}</Alert>;
  if (!departments) return <Spinner />;

  return (
    <section className="card max-w-2xl p-5">
      {error && <Alert>{error}</Alert>}
      <h2 className="mb-3 font-semibold">Departments</h2>
      <ul className="space-y-2">
        {departments.map((d) => (
          <li key={d.id} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm" style={{ background: "var(--surface-sunken)" }}>
            <span>
              {d.name}
              {d._count ? <span className="ml-2 chip">{d._count.jobs} jobs</span> : null}
            </span>
            {editable && (
              <button
                className="text-xs text-red-600 hover:underline"
                onClick={async () => {
                  await api(`/org/departments/${d.id}`, { method: "DELETE" });
                  await load();
                }}
              >
                Delete
              </button>
            )}
          </li>
        ))}
        {!departments.length && (
          <li className="py-3 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No departments yet.
          </li>
        )}
      </ul>
      {editable && (
        <div className="mt-4 flex gap-2">
          <input className="input" placeholder="New department" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            className="btn-secondary"
            disabled={name.trim().length < 1}
            onClick={async () => {
              await api("/org/departments", { body: { name: name.trim() } });
              setName("");
              await load();
            }}
          >
            Add
          </button>
        </div>
      )}
    </section>
  );
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string | null;
  createdAt: string;
  data: Record<string, unknown> | null;
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AuditEntry[]; total: number; pageSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<typeof data>(`/org/audit?page=${page}&pageSize=50`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [page]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;
  const totalPages = Math.ceil(data.total / data.pageSize);

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: "var(--border)", background: "var(--surface-sunken)" }}>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Who</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((e) => (
              <tr key={e.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                <td className="whitespace-nowrap px-4 py-2" style={{ color: "var(--text-muted)" }}>
                  {timeAgo(e.createdAt)}
                </td>
                <td className="px-4 py-2">{e.actorName ?? "System"}</td>
                <td className="px-4 py-2 font-medium">{e.action.replace(/[._]/g, " ")}</td>
                <td className="px-4 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {e.data ? JSON.stringify(e.data).slice(0, 120) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2">
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
  );
}
