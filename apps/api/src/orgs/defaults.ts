import { Prisma } from "../generated/prisma/client";
import { StageKind } from "../generated/prisma/enums";

export const DEFAULT_STAGES: { name: string; kind: StageKind; color: string }[] = [
  { name: "Applied", kind: "APPLIED", color: "#64748b" },
  { name: "Screening", kind: "SCREENING", color: "#0ea5e9" },
  { name: "Shortlisted", kind: "SHORTLISTED", color: "#6366f1" },
  { name: "Assessment", kind: "ASSESSMENT", color: "#a855f7" },
  { name: "Interview", kind: "INTERVIEW", color: "#f59e0b" },
  { name: "Final Review", kind: "FINAL_REVIEW", color: "#f97316" },
  { name: "Offer", kind: "OFFER", color: "#14b8a6" },
  { name: "Hired", kind: "HIRED", color: "#22c55e" },
  { name: "Rejected", kind: "REJECTED", color: "#ef4444" },
];

export async function createDefaultStages(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.pipelineStage.createMany({
    data: DEFAULT_STAGES.map((s, i) => ({ ...s, organizationId, position: i })),
  });
}

/** Stages whose kind carries system meaning and must exist exactly once. */
export const SYSTEM_STAGE_KINDS: StageKind[] = ["APPLIED", "HIRED", "REJECTED"];
