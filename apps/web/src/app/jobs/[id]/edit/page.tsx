"use client";

import { use, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { JobForm } from "@/components/job-form";
import { Alert, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Job>(`/jobs/${id}`).then(setJob).catch((e) => setError(e.message));
  }, [id]);

  return (
    <AppShell>
      <PageHeader title={job ? `Edit: ${job.title}` : "Edit job"} />
      {error && <Alert>{error}</Alert>}
      {!job && !error && <Spinner />}
      {job && <JobForm job={job} />}
    </AppShell>
  );
}
