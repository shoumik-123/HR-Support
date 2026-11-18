import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { throttleTracker, type TrackedRequest } from "./common/throttle-tracker";
import { AiModule } from "./ai/ai.service";
import { ApplicationsController } from "./applications/applications.controller";
import { ApplicationsService } from "./applications/applications.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { AssessmentBankService } from "./assessments/assessment-bank.service";
import { AssessmentBankController, AssessmentsController, PublicAssessmentController } from "./assessments/assessments.controller";
import { AssessmentsService } from "./assessments/assessments.service";
import { ActivityModule } from "./common/activity.service";
import { AuthGuard } from "./common/auth.guard";
import { AllExceptionsFilter } from "./common/http-exception.filter";
import { CandidatesController } from "./candidates/candidates.controller";
import { PublicCareersController } from "./careers/careers.controller";
import { CareersService } from "./careers/careers.service";
import { CommunicationsController } from "./communications/communications.controller";
import { CommunicationsService } from "./communications/communications.service";
import { CandidatesService } from "./candidates/candidates.service";
import { config } from "./config";
import { DashboardController } from "./dashboard/dashboard.controller";
import { DashboardService } from "./dashboard/dashboard.service";
import { HealthController } from "./health.controller";
import { JobsController } from "./jobs/jobs.controller";
import { InterviewSetupController } from "./interviews/interview-setup.controller";
import { InterviewsController } from "./interviews/interviews.controller";
import { InterviewsService } from "./interviews/interviews.service";
import { AvailabilityService, QuestionBankService } from "./interviews/question-bank.service";
import { JobsService } from "./jobs/jobs.service";
import { MailModule } from "./mail/mail.service";
import { OffersController, OnboardingController, PublicOfferController } from "./offers/offers.controller";
import { OffersService } from "./offers/offers.service";
import { MatchingController } from "./matching/matching.controller";
import { MatchingService } from "./matching/matching.service";
import { OrgsController } from "./orgs/orgs.controller";
import { OrgsService } from "./orgs/orgs.service";
import { PrismaModule } from "./prisma/prisma.service";
import { QueueModule } from "./queue/queue.service";
import { MalwareScanner } from "./resumes/malware-scanner";
import { ResumeParserService } from "./resumes/resume-parser.service";
import { ResumesController } from "./resumes/resumes.controller";
import { ResumesService } from "./resumes/resumes.service";
import { StorageModule } from "./storage/storage.service";

@Module({
  imports: [
    PrismaModule,
    ActivityModule,
    StorageModule,
    MailModule,
    QueueModule,
    AiModule,
    JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: config.accessTokenTtl as `${number}${"s" | "m" | "h" | "d"}` } }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: "default", limit: 300, ttl: 60_000 }],
      getTracker: (req) => throttleTracker(req as TrackedRequest, config.jwtSecret),
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    OrgsController,
    JobsController,
    CandidatesController,
    ResumesController,
    ApplicationsController,
    MatchingController,
    InterviewsController,
    InterviewSetupController,
    CommunicationsController,
    AssessmentsController,
    AssessmentBankController,
    PublicAssessmentController,
    OffersController,
    OnboardingController,
    PublicOfferController,
    PublicCareersController,
    DashboardController,
  ],
  providers: [
    AuthService,
    OrgsService,
    JobsService,
    CandidatesService,
    ResumesService,
    ResumeParserService,
    MalwareScanner,
    ApplicationsService,
    MatchingService,
    InterviewsService,
    QuestionBankService,
    AvailabilityService,
    CommunicationsService,
    AssessmentsService,
    AssessmentBankService,
    OffersService,
    CareersService,
    DashboardService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
