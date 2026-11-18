"use client";

import { AppShell } from "@/components/app-shell";
import { JobForm } from "@/components/job-form";
import { PageHeader } from "@/components/ui";

export default function NewJobPage() {
  return (
    <AppShell>
      <PageHeader title="New job" subtitle="Save as a draft first; publish when the details are final." />
      <JobForm />
    </AppShell>
  );
}
