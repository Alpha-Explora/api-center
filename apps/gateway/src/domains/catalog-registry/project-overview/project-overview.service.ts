import { Inject, Injectable } from "@nestjs/common";
import { NotFoundError } from "@shared/errors";
import { RegistryService } from "../registry/registry.service";
import { TenancyService } from "../registry/tenancy.service";
import { TribePlanService } from "@entitlements/tribe-plan.service";
import { TribeQuotaPolicyService } from "@quotas/tribe-quota-policy.service";
import { PAYMENT_CONSUMER_REGISTRATION_DIRECTORY, PaymentConsumerRegistrationDirectory } from "@payments/features/consumer-management/payment-consumer.types";
import { QUOTA_EVALUATION_LEDGER, QuotaEvaluationLedger } from "@quota-ledger/quota-evaluation-ledger.types";

@Injectable()
export class ProjectOverviewService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly registry: RegistryService,
    private readonly plans: TribePlanService,
    private readonly quotaPolicies: TribeQuotaPolicyService,
    @Inject(PAYMENT_CONSUMER_REGISTRATION_DIRECTORY) private readonly paymentConsumers: PaymentConsumerRegistrationDirectory,
    @Inject(QUOTA_EVALUATION_LEDGER) private readonly quotaLedger: QuotaEvaluationLedger,
  ) {}

  async getOverview(projectId: string, organizationFilter?: string) {
    const project = this.tenancy.getProject(projectId);
    if (!project) throw new NotFoundError(`Project '${projectId}' is not registered`);
    const tribe = this.tenancy.getTribe(project.tribeId);
    if (!tribe) throw new NotFoundError(`Tribe '${project.tribeId}' is not registered`);
    if (organizationFilter !== undefined) {
      const allowed = new Set(organizationFilter.split(",").map((id) => id.trim()).filter(Boolean));
      if (!tribe.organizationId || !allowed.has(tribe.organizationId)) {
        throw new NotFoundError("Resource was not found in the requested organization scope");
      }
    }

    const services = this.registry.getProjectServices(projectId).map((service) => ({
      serviceId: service.serviceId,
      name: service.name,
      status: service.status,
      environments: service.environments.map(({ environment, status }) => ({ environment, status })),
    }));
    const [assignments, policies, consumerRegistrations, recentQuotaDecisions] = await Promise.all([
      this.plans.listPlanAssignments({ projectId, status: "active" }),
      this.quotaPolicies.listPolicies({ projectId }),
      this.paymentConsumers.list(tribe.organizationId ? [tribe.organizationId] : undefined),
      this.quotaLedger.listSince({
        ownerTribeId: tribe.tribeId,
        projectId,
        since: new Date(Date.now() - 24 * 60 * 60 * 1000),
        limit: 20,
      }),
    ]);

    return {
      project,
      tribe,
      services,
      plans: assignments.map((assignment) => ({
        environment: assignment.environment,
        assignment,
        effectiveLimits: assignment.effectiveLimits ?? [],
      })),
      quotaPolicyOverrides: policies.filter((policy) => policy.projectId === projectId),
      paymentConsumerRegistrations: consumerRegistrations.filter((registration) =>
        registration.ownerTribeId === tribe.tribeId &&
        services.some((service) => service.serviceId === registration.consumerServiceId),
      ),
      recentQuotaDecisions,
    };
  }
}
