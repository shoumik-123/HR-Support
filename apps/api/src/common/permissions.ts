import { Role } from "../generated/prisma/enums";

/**
 * Fine-grained permissions. Roles map to permission sets below; guards check
 * permissions, never role names, so the mapping can become per-org configurable later.
 */
export const Permission = {
  OrgManage: "org:manage",
  TeamManage: "team:manage",
  TeamView: "team:view",
  AuditView: "audit:view",
  JobView: "job:view",
  JobManage: "job:manage",
  JobPublish: "job:publish",
  CandidateView: "candidate:view",
  CandidateContactView: "candidate:contact:view",
  CandidateManage: "candidate:manage",
  CandidateDelete: "candidate:delete",
  ResumeUpload: "resume:upload",
  PipelineMove: "pipeline:move",
  PipelineReject: "pipeline:reject",
  PipelineConfigure: "pipeline:configure",
  MatchRun: "match:run",
  MatchReview: "match:review",
  NoteWrite: "note:write",
  AnalyticsView: "analytics:view",
  AiUse: "ai:use",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL = Object.values(Permission);

const recruiterSet: Permission[] = [
  Permission.TeamView,
  Permission.JobView,
  Permission.JobManage,
  Permission.CandidateView,
  Permission.CandidateContactView,
  Permission.CandidateManage,
  Permission.ResumeUpload,
  Permission.PipelineMove,
  Permission.PipelineReject,
  Permission.MatchRun,
  Permission.MatchReview,
  Permission.NoteWrite,
  Permission.AnalyticsView,
  Permission.AiUse,
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(ALL),
  ADMIN: new Set(ALL),
  HR_MANAGER: new Set([
    ...recruiterSet,
    Permission.JobPublish,
    Permission.PipelineConfigure,
    Permission.CandidateDelete,
    Permission.AuditView,
  ]),
  RECRUITER: new Set(recruiterSet),
  HIRING_MANAGER: new Set([
    Permission.TeamView,
    Permission.JobView,
    Permission.CandidateView,
    Permission.CandidateContactView,
    Permission.PipelineMove,
    Permission.MatchReview,
    Permission.NoteWrite,
    Permission.AnalyticsView,
  ]),
  INTERVIEWER: new Set([Permission.JobView, Permission.CandidateView, Permission.NoteWrite]),
  EVALUATOR: new Set([Permission.JobView, Permission.CandidateView, Permission.NoteWrite]),
  VIEWER: new Set([Permission.JobView, Permission.CandidateView, Permission.AnalyticsView]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** Roles that a member with `actor` role may assign. Only owners can create owners. */
export function assignableRoles(actor: Role): Role[] {
  const all = Object.keys(ROLE_PERMISSIONS) as Role[];
  if (actor === "OWNER") return all;
  if (actor === "ADMIN") return all.filter((r) => r !== "OWNER");
  return [];
}
