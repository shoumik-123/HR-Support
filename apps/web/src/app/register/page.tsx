"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function RegisterPage() {
  const router = useRouter();
  const { signIn } = useSession();
  const [form, setForm] = useState({ name: "", email: "", organizationName: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setIssues({});
    try {
      const { accessToken } = await api<{ accessToken: string }>("/auth/register", { body: form });
      await signIn(accessToken);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.issues) setIssues(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      } else setError("Could not create your organization. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <form className="card w-full max-w-md space-y-4 p-6" onSubmit={onSubmit}>
        <div>
          <h1 className="text-lg font-semibold">Create your organization</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            You will be the owner and can invite your team afterwards.
          </p>
        </div>
        {error && <Alert>{error}</Alert>}

        <Field label="Your name" error={issues.name}>
          <input className="input" required value={form.name} onChange={set("name")} autoComplete="name" />
        </Field>
        <Field label="Work email" error={issues.email}>
          <input className="input" type="email" required value={form.email} onChange={set("email")} autoComplete="email" />
        </Field>
        <Field label="Organization name" error={issues.organizationName}>
          <input className="input" required value={form.organizationName} onChange={set("organizationName")} autoComplete="organization" />
        </Field>
        <Field label="Password" hint="At least 10 characters, with letters and numbers." error={issues.password}>
          <input className="input" type="password" required value={form.password} onChange={set("password")} autoComplete="new-password" />
        </Field>

        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating…" : "Create organization"}
        </button>
        <p className="text-center text-sm">
          Already have an account?{" "}
          <Link className="text-brand-600 hover:underline" href="/login">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
