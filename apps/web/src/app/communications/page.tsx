"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StatTile } from "@/components/charts";
import { Alert, Field, Modal, PageHeader, Spinner, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type {
  AutomationsResponse,
  AutomationTrigger,
  Communication,
  CommunicationStats,
  EmailTemplate,
  WhatsAppTemplate,
  WhatsAppTemplatesResponse,
} from "@/lib/types";

type Tab = "log" | "templates" | "whatsapp" | "automations";

const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  APPLICATION_CREATED: "A candidate applies",
  STAGE_CHANGED: "A candidate reaches a stage",
  INTERVIEW_SCHEDULED: "An interview is scheduled",
  INTERVIEW_RESCHEDULED: "An interview is rescheduled",
  INTERVIEW_CANCELLED: "An interview is cancelled",
  INTERVIEW_REMINDER: "Before an interview",
  APPLICATION_REJECTED: "An application is rejected",
  CANDIDATE_HIRED: "A candidate is hired",
};

const TRIGGER_NOTE: Partial<Record<AutomationTrigger, string>> = {
  APPLICATION_REJECTED: "The rejection itself is always a human decision; this only sends the notification afterwards.",
  INTERVIEW_SCHEDULED: "Invitations are already sent when you schedule and tick “email the candidate”. Turn this on only if you want it to happen every time, automatically.",
  INTERVIEW_REMINDER: "Sent ahead of the interview to candidates who have one booked.",
};

export default function CommunicationsPage() {
  return (
    <AppShell>
      <Communications />
    </AppShell>
  );
}

function Communications() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>("log");

  return (
    <>
      <PageHeader title="Communications" subtitle="What the platform has sent candidates, and what it sends automatically" />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }} role="tablist">
        {([
          ["log", "Sent messages"],
          ["templates", "Email templates"],
          ["whatsapp", "WhatsApp"],
          ["automations", "Automations"],
        ] as [Tab, string][]).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={`-mb-px shrink-0 border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${tab === value ? "border-brand-600 text-brand-600" : "border-transparent hover:text-brand-600"}`}
            style={tab === value ? undefined : { color: "var(--text-muted)" }}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "log" && <MessageLog />}
      {tab === "templates" && <Templates canEdit={can("email:template:manage")} />}
      {tab === "whatsapp" && <WhatsAppTemplates canEdit={can("email:template:manage")} canManageOrg={can("org:manage")} />}
      {tab === "automations" && <Automations canEdit={can("automation:manage")} />}
    </>
  );
}

function MessageLog() {
  const [data, setData] = useState<{ items: Communication[]; total: number; pageSize: number } | null>(null);
  const [stats, setStats] = useState<CommunicationStats | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [open, setOpen] = useState<Communication | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (status) params.set("status", status);
    api<typeof data>(`/communications?${params}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load messages"));
  }, [page, status]);

  useEffect(() => {
    void load();
    api<CommunicationStats>("/communications/stats?days=30").then(setStats).catch(() => setStats(null));
  }, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;
  const totalPages = Math.ceil(data.total / data.pageSize);

  return (
    <>
      {stats && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Delivered" value={stats.sent} sub={stats.deliveryRate != null ? `${stats.deliveryRate}% of attempts` : "last 30 days"} />
          <StatTile label="Waiting to send" value={stats.queued} sub="in the queue" />
          <StatTile label="Failed" value={stats.failed} sub={stats.failed ? "needs a retry" : "none"} tone={stats.failed ? "attention" : "default"} />
          <StatTile label="Not sent" value={stats.skipped} sub="no email on file, or template off" />
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by outcome">
          {["", "SENT", "DELIVERED", "READ", "QUEUED", "FAILED", "SKIPPED"].map((s) => (
            <button key={s || "all"} className={status === s ? "btn-primary py-1.5" : "btn-secondary py-1.5"} onClick={() => { setStatus(s); setPage(1); }}>
              {s ? s.charAt(0) + s.slice(1).toLowerCase() : "All"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by channel">
          {([["", "Both channels"], ["EMAIL", "Email"], ["WHATSAPP", "WhatsApp"]] as [string, string][]).map(([value, label]) => (
            <button key={value || "any"} className={channel === value ? "btn-primary py-1.5" : "btn-secondary py-1.5"} onClick={() => { setChannel(value); setPage(1); }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {data.items.length === 0 ? (
        <p className="card p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Nothing sent yet.
        </p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--border)", background: "var(--surface-sunken)" }}>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-4 py-2 font-medium">To</th>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Sent by</th>
                <th className="px-4 py-2 font-medium">Outcome</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="whitespace-nowrap px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                    {timeAgo(c.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="chip text-xs">{c.channel === "WHATSAPP" ? "WhatsApp" : "Email"}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    {c.candidate ? (
                      <Link className="hover:underline" href={`/candidates/${c.candidate.id}`}>
                        {c.candidate.fullName}
                      </Link>
                    ) : (
                      c.toEmail ?? c.toPhone ?? "—"
                    )}
                  </td>
                  <td className="max-w-xs truncate px-4 py-2.5">{c.subject}</td>
                  <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                    {c.sentByName ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <OutcomeChip communication={c} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="text-sm text-brand-600 hover:underline" onClick={() => setOpen(c)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.subject ?? "Message"} wide>
        {open && (
          <div className="space-y-3">
            <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
              <div>
                <dt className="hint">To</dt>
                <dd>{open.toEmail}</dd>
              </div>
              <div>
                <dt className="hint">Outcome</dt>
                <dd>
                  <OutcomeChip communication={open} />
                </dd>
              </div>
              <div>
                <dt className="hint">Template</dt>
                <dd>{open.template?.name ?? open.templateKey?.replace(/_/g, " ").toLowerCase() ?? "One-off message"}</dd>
              </div>
              <div>
                <dt className="hint">Sent by</dt>
                <dd>{open.sentByName ?? "—"}</dd>
              </div>
            </dl>
            {open.skipReason && <Alert kind="info">Not sent: {open.skipReason}</Alert>}
            {open.error && <Alert>{open.error}</Alert>}
            {open.body && (
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg p-3 text-sm" style={{ background: "var(--surface-sunken)" }}>
                {open.body}
              </pre>
            )}
            {open.status === "FAILED" && (
              <button
                className="btn-primary"
                onClick={async () => {
                  await api(`/communications/${open.id}/retry`, { method: "POST" });
                  setOpen(null);
                  void load();
                }}
              >
                Try sending again
              </button>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function OutcomeChip({ communication }: { communication: Communication }) {
  const tone: Record<string, string> = {
    SENT: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
    DELIVERED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
    READ: "bg-emerald-200 text-emerald-900 dark:bg-emerald-800/60 dark:text-emerald-100",
    QUEUED: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
    FAILED: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
    SKIPPED: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone[communication.status]}`}>{communication.status.toLowerCase()}</span>
      {communication.automated && <span className="chip text-[10px]">auto</span>}
    </span>
  );
}

function Templates({ canEdit }: { canEdit: boolean }) {
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [variables, setVariables] = useState<{ name: string; description: string }[]>([]);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<EmailTemplate[]>("/communications/templates")
      .then(setTemplates)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load templates"));
  }, []);

  useEffect(() => {
    void load();
    api<{ name: string; description: string }[]>("/communications/variables").then(setVariables).catch(() => setVariables([]));
  }, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!templates) return <Spinner />;

  return (
    <>
      {!canEdit && <Alert kind="info">You can read these templates. Editing them needs HR manager rights.</Alert>}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <article key={t.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-medium">{t.name}</h3>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {t.key.replace(/_/g, " ").toLowerCase()}
                  {t.isDefault && " · unedited default"}
                </p>
              </div>
              {!t.enabled && <span className="chip shrink-0 text-xs">off</span>}
            </div>
            <p className="mt-2 truncate text-sm font-medium">{t.subject}</p>
            <p className="mt-1 line-clamp-3 text-sm" style={{ color: "var(--text-muted)" }}>
              {t.body}
            </p>
            <button className="btn-secondary mt-3 py-1.5" onClick={() => setEditing(t)}>
              {canEdit ? "Edit" : "View"}
            </button>
          </article>
        ))}
      </div>

      <TemplateEditor
        template={editing}
        variables={variables}
        canEdit={canEdit}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    </>
  );
}

function TemplateEditor({
  template,
  variables,
  canEdit,
  onClose,
  onSaved,
}: {
  template: EmailTemplate | null;
  variables: { name: string; description: string }[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (template) {
      setSubject(template.subject);
      setBody(template.body);
      setEnabled(template.enabled);
      setError(null);
    }
  }, [template]);

  if (!template) return null;

  return (
    <Modal open onClose={onClose} title={template.name} wide>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <Field label="Subject">
          <input className="input" value={subject} disabled={!canEdit} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Message" hint="Use the placeholders below; they are filled in per candidate when the email is sent.">
          <textarea className="input min-h-64 font-mono text-sm" value={body} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} />
        </Field>

        <details className="rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
          <summary className="cursor-pointer text-sm font-medium">Available placeholders ({variables.length})</summary>
          <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            {variables.map((v) => (
              <li key={v.name}>
                <button
                  type="button"
                  className="font-mono text-brand-600 hover:underline disabled:text-[var(--text-muted)] disabled:no-underline"
                  disabled={!canEdit}
                  onClick={() => setBody((b) => `${b}{{${v.name}}}`)}
                >
                  {`{{${v.name}}}`}
                </button>
                <span style={{ color: "var(--text-muted)" }}> — {v.description}</span>
              </li>
            ))}
          </ul>
        </details>

        {canEdit && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              This template may be sent
            </label>
            <div className="flex gap-2">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api(`/communications/templates/${template.id}`, { method: "PATCH", body: { subject, body, enabled } });
                    onSaved();
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : "Could not save the template");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save template
              </button>
              <button className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function WhatsAppTemplates({ canEdit, canManageOrg }: { canEdit: boolean; canManageOrg: boolean }) {
  const [data, setData] = useState<WhatsAppTemplatesResponse | null>(null);
  const [editing, setEditing] = useState<WhatsAppTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<WhatsAppTemplatesResponse>("/communications/whatsapp/templates")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load WhatsApp templates"));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleForOrganization(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api("/org", { method: "PATCH", body: { whatsappEnabled: enabled } });
      void load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change the setting");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;

  return (
    <>
      <div className="card mb-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold">WhatsApp messages</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
              {data.enabledForOrganization
                ? "On. Messages go to the candidate's phone, so these are kept short and only sent for things that cannot wait."
                : "Off. Nothing is sent to a candidate's phone until someone turns this on."}
              {data.businessNumber ? ` Candidates see messages from ${data.businessNumber}.` : ""}
            </p>
          </div>
          {canManageOrg ? (
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <input type="checkbox" checked={data.enabledForOrganization} disabled={busy} onChange={(e) => void toggleForOrganization(e.target.checked)} />
              Send WhatsApp messages
            </label>
          ) : (
            <span className="chip shrink-0">{data.enabledForOrganization ? "on" : "off"}</span>
          )}
        </div>

        {!data.providerConnected && (
          <Alert kind="warning">
            No WhatsApp provider is connected on this server, so messages are written to the log with their full text but not delivered. Set
            WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID to start sending; nothing else changes.
          </Alert>
        )}
      </div>

      {!canEdit && <Alert kind="info">You can read these messages. Editing them needs HR manager rights.</Alert>}

      <div className="grid gap-3 md:grid-cols-2">
        {data.templates.map((t) => (
          <article key={t.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-medium">{t.name}</h3>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {t.key.replace(/_/g, " ").toLowerCase()}
                  {t.isDefault && " · unedited default"}
                  {t.providerTemplateName ? ` · approved as ${t.providerTemplateName}` : " · no approved template name"}
                </p>
              </div>
              {!t.enabled && <span className="chip shrink-0 text-xs">off</span>}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: "var(--text-muted)" }}>
              {t.body}
            </p>
            <div className="mt-3 flex items-center justify-between">
              <button className="btn-secondary py-1.5" onClick={() => setEditing(t)}>
                {canEdit ? "Edit" : "View"}
              </button>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t.length}/1024 characters
              </span>
            </div>
          </article>
        ))}
      </div>

      <WhatsAppTemplateEditor
        template={editing}
        canEdit={canEdit}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    </>
  );
}

function WhatsAppTemplateEditor({
  template,
  canEdit,
  onClose,
  onSaved,
}: {
  template: WhatsAppTemplate | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [providerTemplateName, setProviderTemplateName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (template) {
      setBody(template.body);
      setName(template.name);
      setProviderTemplateName(template.providerTemplateName ?? "");
      setEnabled(template.enabled);
      setError(null);
    }
  }, [template]);

  if (!template) return null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/communications/whatsapp/templates/${template!.id}`, {
        method: "PATCH",
        body: { name, body, enabled, providerTemplateName: providerTemplateName.trim() || null },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={canEdit ? `Edit: ${template.name}` : template.name} wide>
      {error && <Alert>{error}</Alert>}
      <Field label="Name" hint="Only your team sees this.">
        <input className="input" value={name} maxLength={80} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Message" hint="Placeholders like {{candidate.firstName}} work here exactly as in email. Keep it to a few lines — this is read on a phone.">
        <textarea className="input min-h-40 font-mono text-sm" value={body} maxLength={1024} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {body.length}/1024 characters
      </p>
      <Field
        label="Approved template name with your provider"
        hint="WhatsApp only delivers wording it has already approved, unless the candidate wrote to you in the last 24 hours. Leave this empty until you have registered it."
      >
        <input className="input" value={providerTemplateName} maxLength={120} disabled={!canEdit} placeholder="e.g. interview_invitation_en" onChange={(e) => setProviderTemplateName(e.target.value)} />
      </Field>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} />
        Available to send
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          {canEdit ? "Cancel" : "Close"}
        </button>
        {canEdit && (
          <button className="btn-primary" onClick={() => void save()} disabled={busy || body.trim().length < 10}>
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </div>
    </Modal>
  );
}

function Automations({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<AutomationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AutomationsResponse>("/communications/automations")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load automations"));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;

  const simpleTriggers: AutomationTrigger[] = [
    "APPLICATION_CREATED",
    "INTERVIEW_SCHEDULED",
    "INTERVIEW_RESCHEDULED",
    "INTERVIEW_CANCELLED",
    "INTERVIEW_REMINDER",
    "APPLICATION_REJECTED",
    "CANDIDATE_HIRED",
  ];

  async function save(
    trigger: AutomationTrigger,
    stageId: string | null,
    templateId: string,
    enabled: boolean,
    offsetHours?: number,
    whatsappTemplateId?: string | null,
  ) {
    setSaving(`${trigger}:${stageId ?? ""}`);
    setError(null);
    try {
      await api("/communications/automations", { method: "PUT", body: { trigger, stageId, templateId, enabled, offsetHours, whatsappTemplateId } });
      void load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the automation");
    } finally {
      setSaving(null);
    }
  }

  const ruleFor = (trigger: AutomationTrigger, stageId: string | null = null) =>
    data.rules.find((r) => r.trigger === trigger && (r.stageId ?? null) === stageId);

  return (
    <div className="space-y-4">
      <Alert kind="info">
        Automated email is off until you turn it on. Candidates only receive these once you enable them, and every send is recorded in the log.
      </Alert>
      {!canEdit && <Alert kind="info">Changing automations needs HR manager rights.</Alert>}

      <section className="card divide-y p-0" style={{ borderColor: "var(--border)" }}>
        {simpleTriggers.map((trigger) => {
          const rule = ruleFor(trigger);
          const key = `${trigger}:`;
          return (
            <div key={trigger} className="flex flex-wrap items-center gap-3 p-4" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{TRIGGER_LABEL[trigger]}</p>
                {TRIGGER_NOTE[trigger] && (
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {TRIGGER_NOTE[trigger]}
                  </p>
                )}
              </div>

              <select
                className="input w-auto py-1.5 text-sm"
                aria-label={`Email template for: ${TRIGGER_LABEL[trigger]}`}
                value={rule?.templateId ?? ""}
                disabled={!canEdit || saving === key}
                onChange={(e) => void save(trigger, null, e.target.value, rule?.enabled ?? false, rule?.offsetHours, rule?.whatsappTemplateId ?? null)}
              >
                <option value="">Choose a template…</option>
                {data.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              {rule?.templateId && (
                <select
                  className="input w-auto py-1.5 text-sm"
                  aria-label={`WhatsApp message for: ${TRIGGER_LABEL[trigger]}`}
                  value={rule.whatsappTemplateId ?? ""}
                  disabled={!canEdit || saving === key}
                  onChange={(e) => void save(trigger, null, rule.templateId, rule.enabled, rule.offsetHours, e.target.value || null)}
                >
                  <option value="">No WhatsApp</option>
                  {data.whatsappTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      + WhatsApp: {t.name}
                    </option>
                  ))}
                </select>
              )}

              {trigger === "INTERVIEW_REMINDER" && rule && (
                <select
                  className="input w-auto py-1.5 text-sm"
                  value={rule.offsetHours}
                  disabled={!canEdit}
                  onChange={(e) => void save(trigger, null, rule.templateId, rule.enabled, Number(e.target.value))}
                >
                  {[2, 4, 12, 24, 48].map((h) => (
                    <option key={h} value={h}>
                      {h}h before
                    </option>
                  ))}
                </select>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={rule?.enabled ?? false}
                  disabled={!canEdit || !rule?.templateId}
                  onChange={(e) => rule && void save(trigger, null, rule.templateId, e.target.checked, rule.offsetHours, rule.whatsappTemplateId ?? null)}
                />
                On
              </label>
            </div>
          );
        })}
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">When a candidate reaches a stage</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--text-muted)" }}>
          Send a specific template the moment someone is moved into a stage — for example a shortlist notice.
        </p>
        <div className="space-y-2">
          {data.stages.map((stage) => {
            const rule = ruleFor("STAGE_CHANGED", stage.id);
            return (
              <div key={stage.id} className="flex flex-wrap items-center gap-3 rounded-lg p-2.5" style={{ background: "var(--surface-sunken)" }}>
                <span className="min-w-28 flex-1 text-sm font-medium">{stage.name}</span>
                <select
                  className="input w-auto py-1.5 text-sm"
                  aria-label={`Email template for the ${stage.name} stage`}
                  value={rule?.templateId ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => void save("STAGE_CHANGED", stage.id, e.target.value, rule?.enabled ?? false, undefined, rule?.whatsappTemplateId ?? null)}
                >
                  <option value="">No email</option>
                  {data.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {rule?.templateId && (
                  <select
                    className="input w-auto py-1.5 text-sm"
                    aria-label={`WhatsApp message for the ${stage.name} stage`}
                    value={rule.whatsappTemplateId ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => void save("STAGE_CHANGED", stage.id, rule.templateId, rule.enabled, undefined, e.target.value || null)}
                  >
                    <option value="">No WhatsApp</option>
                    {data.whatsappTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        + WhatsApp: {t.name}
                      </option>
                    ))}
                  </select>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rule?.enabled ?? false}
                    disabled={!canEdit || !rule?.templateId}
                    onChange={(e) => rule && void save("STAGE_CHANGED", stage.id, rule.templateId, e.target.checked, undefined, rule.whatsappTemplateId ?? null)}
                  />
                  On
                </label>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
