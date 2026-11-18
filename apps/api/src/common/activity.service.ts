import { Global, Injectable, Module } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface ActivityInput {
  orgId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  candidateId?: string | null;
  jobId?: string | null;
  applicationId?: string | null;
  data?: Prisma.InputJsonValue;
  ip?: string;
}

type Tx = Prisma.TransactionClient | PrismaService;

/** Append-only activity timeline + audit trail. */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: ActivityInput, tx: Tx = this.prisma) {
    await tx.activity.create({
      data: {
        organizationId: input.orgId,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        candidateId: input.candidateId ?? null,
        jobId: input.jobId ?? null,
        applicationId: input.applicationId ?? null,
        data: input.data,
        ipAddress: input.ip,
      },
    });
  }
}

@Global()
@Module({ providers: [ActivityService], exports: [ActivityService] })
export class ActivityModule {}
