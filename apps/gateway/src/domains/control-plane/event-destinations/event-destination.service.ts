// Event destinations: one recipient application's payment events in one environment, delivered
// to an authenticated Pub/Sub push endpoint. Provisioning reuses the payment event subscription
// provisioner (HTTPS Cloud Run endpoint, OIDC push, dead-lettering, environment match).
// Payment events created by an application carry its ID as consumerServiceId, which is the
// subscription filter.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { PaymentPubSubProvisioningService } from "@payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";
import { AppError, ConflictError, NotFoundError } from "@shared/errors";
import { newResourceId } from "../application-credential";
import { withTenant } from "../tenant-transaction";
import type { EnvironmentScope } from "../control-plane-admin.service";

export interface DestinationInput {
  recipientApplicationId: string;
  pushEndpoint: string;
  oidcAudience?: string;
  deliveryServiceAccountEmail: string;
}

@Injectable()
export class EventDestinationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioner: PaymentPubSubProvisioningService,
    private readonly audit: AuditEventsService,
  ) {}

  async create(scope: EnvironmentScope, input: DestinationInput, actor: string) {
    const prepared = await withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await db.cpEnvironment.findFirst({
        where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
      });
      if (!environment) throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
      const application = await db.cpApplication.findFirst({
        where: { id: input.recipientApplicationId, organizationId: scope.organizationId, environmentId: environment.id },
      });
      if (!application) throw new NotFoundError(`Application '${input.recipientApplicationId}' was not found in this environment`);
      const payments = await db.cpCapabilityInstallation.findFirst({
        where: { organizationId: scope.organizationId, environmentId: environment.id, capability: "payments", status: "enabled" },
      });
      if (!payments) throw new AppError("Enable payments in this environment before adding a payment event destination", 409, "CAPABILITY_NOT_ENABLED");
      const owner = await db.cpResourceOwnerMapping.findFirst({
        where: { organizationId: scope.organizationId, projectId: scope.projectId, environmentKind: scope.environmentKind },
      });
      const existing = await db.cpEventDestination.findFirst({
        where: { recipientApplicationId: application.id, eventFamily: "payments", status: { not: "disabled" } },
      });
      if (existing) throw new ConflictError("This application already has a payment event destination");
      const destination = await db.cpEventDestination.create({
        data: {
          id: newResourceId("dst"),
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          environmentId: environment.id,
          recipientApplicationId: application.id,
          pushEndpoint: input.pushEndpoint,
          oidcAudience: input.oidcAudience ?? null,
          deliveryServiceAccountEmail: input.deliveryServiceAccountEmail,
          createdBy: actor,
        },
      });
      return { destination, ownerGroupId: owner?.ownerGroupId ?? scope.organizationId };
    });

    let status: "active" | "failed" = "active";
    let subscriptionName: string | null = null;
    let lastError: string | null = null;
    try {
      const result = await this.provisioner.provision({
        ownerTribeId: prepared.ownerGroupId,
        consumerServiceId: input.recipientApplicationId,
        environment: scope.environmentKind,
        endpointEnvironment: scope.environmentKind,
        pushEndpoint: input.pushEndpoint,
        ...(input.oidcAudience ? { oidcAudience: input.oidcAudience } : {}),
        deliveryServiceAccountEmail: input.deliveryServiceAccountEmail,
        consumerProjectId: scope.projectId,
      });
      subscriptionName = result.subscriptionName;
    } catch (error) {
      status = "failed";
      lastError = (error instanceof Error ? error.message : "Provisioning failed").slice(0, 500);
    }
    const destination = await withTenant(this.prisma, { organizationId: scope.organizationId }, (db) =>
      db.cpEventDestination.update({ where: { id: prepared.destination.id }, data: { status, subscriptionName, lastError } }),
    );
    await this.audit.record({
      type: `control_plane.event_destination.${status}`,
      actionFamily: "runtime",
      actor,
      resourceType: "cp_event_destination",
      resourceId: destination.id,
      environment: scope.environmentKind,
      severity: status === "active" ? "info" : "error",
      message: `Payment event destination ${status}`,
      payload: { recipientApplicationId: input.recipientApplicationId, subscriptionName },
    });
    return destination;
  }

  async list(scope: EnvironmentScope) {
    return withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await db.cpEnvironment.findFirst({
        where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
      });
      if (!environment) throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
      return db.cpEventDestination.findMany({ where: { organizationId: scope.organizationId, environmentId: environment.id }, orderBy: { createdAt: "asc" } });
    });
  }

  /**
   * Stops treating the destination as configured. The Pub/Sub subscription is left for the
   * operator to delete after draining, so no in-flight event is dropped silently.
   */
  async disable(scope: EnvironmentScope, destinationId: string, actor: string) {
    const destination = await withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const found = await db.cpEventDestination.findFirst({ where: { id: destinationId, organizationId: scope.organizationId, projectId: scope.projectId } });
      if (!found) throw new NotFoundError(`Event destination '${destinationId}' was not found`);
      return db.cpEventDestination.update({ where: { id: destinationId }, data: { status: "disabled" } });
    });
    await this.audit.record({
      type: "control_plane.event_destination.disabled",
      actionFamily: "runtime",
      actor,
      resourceType: "cp_event_destination",
      resourceId: destinationId,
      environment: scope.environmentKind,
      severity: "warning",
      message: "Payment event destination disabled; delete its Pub/Sub subscription after draining",
      payload: { subscriptionName: destination.subscriptionName },
    });
    return destination;
  }
}
