import { RequestContext } from "../common/context";
import { can, Permission } from "../common/permissions";
import { Candidate } from "../generated/prisma/client";

export const IDENTITY_FIELDS = ["email", "phone", "location", "linkedinUrl", "githubUrl", "portfolioUrl"] as const;

export function blindLabel(id: string) {
  return `Candidate ${id.slice(-6).toUpperCase()}`;
}

/**
 * Whether identity should be hidden for this viewer. Blind recruitment mode hides identity
 * org-wide; members without contact permission never see it.
 */
export function shouldMask(ctx: RequestContext, orgBlind: boolean, reveal = false): boolean {
  if (!can(ctx.role, Permission.CandidateContactView)) return true;
  return orgBlind && !reveal;
}

export function maskCandidate<T extends Pick<Candidate, "id" | "fullName"> & Partial<Candidate>>(c: T): T & { masked: true } {
  const out: Record<string, unknown> = { ...c, fullName: blindLabel(c.id), masked: true };
  for (const f of IDENTITY_FIELDS) if (f in out) out[f] = null;
  return out as T & { masked: true };
}

export function view<T extends Pick<Candidate, "id" | "fullName"> & Partial<Candidate>>(c: T, mask: boolean) {
  return mask ? maskCandidate(c) : { ...c, masked: false as const };
}
