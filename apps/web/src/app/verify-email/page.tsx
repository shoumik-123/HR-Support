"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Alert, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center"><Spinner /></div>}>
      <Verify />
    </Suspense>
  );
}

function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    api("/auth/verify-email", { body: { token } })
      .then(() => setState("done"))
      .catch((e) => {
        setState("error");
        setMessage(e instanceof ApiError ? e.message : "This link is invalid or has expired.");
      });
  }, [token]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="card w-full max-w-sm space-y-3 p-6 text-center">
        {state === "working" && <Spinner label="Verifying your email…" />}
        {state === "done" && <Alert kind="success">Your email is verified.</Alert>}
        {state === "error" && <Alert>{message}</Alert>}
        <Link className="btn-primary w-full" href="/dashboard">
          Continue
        </Link>
      </div>
    </main>
  );
}
