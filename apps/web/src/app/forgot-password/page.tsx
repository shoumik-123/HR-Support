"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Field } from "@/components/ui";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/auth/forgot-password", { body: { email } });
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <form className="card w-full max-w-sm space-y-4 p-6" onSubmit={onSubmit}>
        <h1 className="text-lg font-semibold">Reset your password</h1>
        {sent ? (
          <Alert kind="success">If an account exists for {email}, a reset link is on its way.</Alert>
        ) : (
          <>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              We&apos;ll email you a link to set a new password.
            </p>
            <Field label="Work email">
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </>
        )}
        <p className="text-center text-sm">
          <Link className="text-brand-600 hover:underline" href="/login">
            Back to sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
