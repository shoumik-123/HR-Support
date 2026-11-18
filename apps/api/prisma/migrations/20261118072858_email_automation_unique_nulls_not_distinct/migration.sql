-- Postgres treats NULLs as distinct in a unique index, so the constraint on
-- (organizationId, trigger, stageId) would allow several automations for the same
-- non-stage trigger. NULLS NOT DISTINCT enforces exactly one.
DROP INDEX IF EXISTS "EmailAutomation_organizationId_trigger_stageId_key";
CREATE UNIQUE INDEX "EmailAutomation_organizationId_trigger_stageId_key"
  ON "EmailAutomation" ("organizationId", "trigger", "stageId") NULLS NOT DISTINCT;
