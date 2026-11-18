import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignableRoles, can, Permission, ROLE_PERMISSIONS } from "../src/common/permissions";
import { blindLabel, maskCandidate, shouldMask } from "../src/candidates/candidate-view";
import type { RequestContext } from "../src/common/context";
import type { Role } from "../src/generated/prisma/enums";

const ctx = (role: Role): RequestContext => ({ userId: "u1", sessionId: "s1", email: "a@b.c", name: "A", orgId: "o1", role });

describe("role permissions", () => {
  it("owners and admins hold every permission", () => {
    for (const p of Object.values(Permission)) {
      assert.ok(can("OWNER", p), `OWNER missing ${p}`);
      assert.ok(can("ADMIN", p), `ADMIN missing ${p}`);
    }
  });

  it("recruiters cannot manage the organisation, team or pipeline configuration", () => {
    assert.equal(can("RECRUITER", Permission.OrgManage), false);
    assert.equal(can("RECRUITER", Permission.TeamManage), false);
    assert.equal(can("RECRUITER", Permission.PipelineConfigure), false);
    assert.equal(can("RECRUITER", Permission.CandidateDelete), false);
  });

  it("recruiters can do their job", () => {
    for (const p of [Permission.JobManage, Permission.ResumeUpload, Permission.MatchRun, Permission.PipelineMove, Permission.PipelineReject]) {
      assert.ok(can("RECRUITER", p), `RECRUITER missing ${p}`);
    }
  });

  it("viewers and interviewers cannot move or reject candidates", () => {
    for (const role of ["VIEWER", "INTERVIEWER", "EVALUATOR"] as Role[]) {
      assert.equal(can(role, Permission.PipelineMove), false, `${role} can move`);
      assert.equal(can(role, Permission.PipelineReject), false, `${role} can reject`);
      assert.equal(can(role, Permission.CandidateDelete), false, `${role} can delete`);
    }
  });

  it("interviewers and evaluators cannot see candidate contact details", () => {
    assert.equal(can("INTERVIEWER", Permission.CandidateContactView), false);
    assert.equal(can("EVALUATOR", Permission.CandidateContactView), false);
  });

  it("only owners can assign the owner role", () => {
    assert.ok(assignableRoles("OWNER").includes("OWNER"));
    assert.ok(!assignableRoles("ADMIN").includes("OWNER"));
    assert.deepEqual(assignableRoles("HR_MANAGER"), []);
    assert.deepEqual(assignableRoles("RECRUITER"), []);
  });

  it("every role has an entry", () => {
    const roles: Role[] = ["OWNER", "ADMIN", "HR_MANAGER", "RECRUITER", "HIRING_MANAGER", "INTERVIEWER", "EVALUATOR", "VIEWER"];
    for (const r of roles) assert.ok(ROLE_PERMISSIONS[r], `no permissions defined for ${r}`);
  });
});

describe("blind recruitment mode", () => {
  it("masks identity when the organisation has blind mode on", () => {
    assert.equal(shouldMask(ctx("RECRUITER"), true), true);
    assert.equal(shouldMask(ctx("RECRUITER"), false), false);
  });

  it("lets an authorised reviewer reveal identity deliberately", () => {
    assert.equal(shouldMask(ctx("RECRUITER"), true, true), false);
  });

  it("never reveals identity to roles without contact permission, even on reveal", () => {
    assert.equal(shouldMask(ctx("INTERVIEWER"), false), true);
    assert.equal(shouldMask(ctx("INTERVIEWER"), false, true), true);
  });

  it("strips every identity field when masking", () => {
    const masked = maskCandidate({
      id: "cand_abc123", fullName: "Arif Chowdhury", email: "arif@example.com", phone: "+8801712345601",
      location: "Dhaka", linkedinUrl: "https://linkedin.com/in/x", githubUrl: null, portfolioUrl: null,
    } as never) as Record<string, unknown>;
    assert.equal(masked.fullName, blindLabel("cand_abc123"));
    for (const field of ["email", "phone", "location", "linkedinUrl"]) {
      assert.equal(masked[field], null, `${field} leaked`);
    }
    assert.ok(!JSON.stringify(masked).includes("Arif"));
  });
});
