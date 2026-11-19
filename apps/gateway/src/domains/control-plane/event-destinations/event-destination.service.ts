// Event destinations: one recipient application's payment events in one environment.
//
// Two transports share one pipeline. Payment events created by an application carry its ID as
// consumerServiceId, which is the filter of a Pub/Sub subscription provisioned for the destination
// (dead-lettering, retries, environment match). The subscription pushes to:
// - 'pubsub-push': the consumer's own Cloud Run endpoint, authenticated with a Google OIDC token;
// - 'webhook': APICenter's delivery service, which signs each event (Standard Webhooks) and POSTs it
//   to any public HTTPS URL. Its URL and signing secrets live in Secret Manager, never in this table.

import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { PaymentPubSubProvisioningService } from "@payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";
import { AppError, ConflictError, NotFoundError } from "@shared/errors";
import { assertPublicUpstream, upstreamGuardOptions } from "@shared/proxy/upstream-guard";
import { newResourceId } from "../application-credential";
import { withTenant } from "../tenant-transaction";
import { assertControlPlaneAuthority } from "../migration/authority";
import type { EnvironmentScope } from "../control-plane-admin.service";
import { newSigningSecret, WEBHOOK_CONFIG_STORE, type WebhookConfigStore } from "./webhook-config-store";

export interface DestinationInput {
  recipientApplicationId: string;
  pushEndpoint: string;
  oidcAudience?: string;
  deliveryServiceAccountEmail: string;
}

export interface WebhookInput {
  recipientApplicationId: string;
  url: string;
}

/** How long a rotated-out signing secret keeps signing, so consumers can switch without a gap. */
export const ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;

type Delivery = { pushEndpoint: string; oidcAudience?: string; deliveryServiceAccountEmail: string };

@Injectable()
export class EventDestinationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioner: PaymentPubSubProvisioningService,
    private readonly audit: AuditEventsService,
    @Inject(WEBHOOK_CONFIG_STORE) private readonly webhooks: WebhookConfigStore,
  ) {}

  async create(scope: EnvironmentScope, input: DestinationInput, actor: string) {
    const prepared = await this.prepare(scope, input.recipientApplicationId, newResourceId("dst"), {
      transport: "pubsub-push",
      pushEndpoint: input.pushEndpoint,
      oidcAudience: input.oidcAudience ?? null,
      deliveryServiceAccountEmail: input.deliveryServiceAccountEmail,
    }, actor);
    return this.provision(scope, prepared, input, actor);
  }

  /**
   * Creates a signed-webhook destination and returns its signing secret, which is shown only once.
   * The secret is stored before the subscription exists, so no event can arrive unsigned.
   */
  async createWebhook(scope: EnvironmentScope, input: WebhookInput, actor: string) {
    const url = (await assertPublicUpstream(input.url, upstreamGuardOptions())).toString();
    const delivery = webhookDeliveryTarget();
    const id = newResourceId("dst");
    const pushEndpoint = `${delivery.url}/deliveries/${id}`;
    const prepared = await this.prepare(scope, input.recipientApplicationId, id, {
      transport: "webhook",
      webhookUrl: url,
      pushEndpoint,
      oidcAudience: delivery.url,
      deliveryServiceAccountEmail: delivery.pushServiceAccount,
    }, actor);
    const signingSecret = newSigningSecret();
    try {
      await this.webhooks.write(id, { url, secrets: [{ value: signingSecret }] });
    } catch (error) {
      await withTenant(this.prisma, { organizationId: scope.organizationId }, (db) =>
        db.cpEventDestination.update({
          where: { id },
          data: { status: "failed", lastError: `Storing the signing secret failed: ${(error as Error).message}`.slice(0, 500) },
        }),
      );
      throw error;
    }
    const destination = await this.provision(scope, prepared, {
      pushEndpoint,
      oidcAudience: delivery.url,
      deliveryServiceAccountEmail: delivery.pushServiceAccount,
    }, actor);
    return { ...destination, signingSecret };
  }

  /**
   * Issues a new signing secret. The previous one keeps signing for ROTATION_OVERLAP_MS, so a
   * consumer can deploy the new secret before the old one stops; returns the new secret once.
   */
  async rotateSecret(scope: EnvironmentScope, destinationId: string, actor: string) {
    const destination = await this.find(scope, destinationId);
    if (destination.transport !== "webhook") throw new AppError("Only webhook destinations have a signing secret", 409, "NOT_A_WEBHOOK");
    if (destination.status === "disabled") throw new ConflictError("This destination is disabled");
    const config = await this.webhooks.read(destinationId);
    if (!config) throw new AppError("This webhook's configuration is missing; create the destination again", 409, "WEBHOOK_CONFIG_MISSING");
    const signingSecret = newSigningSecret();
    const expiresAt = new Date(Date.now() + ROTATION_OVERLAP_MS).toISOString();
    const current = config.secrets.find((secret) => !secret.expiresAt);
    await this.webhooks.write(destinationId, {
      ...config,
      secrets: [{ value: signingSecret }, ...(current ? [{ value: current.value, expiresAt }] : [])],
    });
    const updated = await withTenant(this.prisma, { organizationId: scope.organizationId }, (db) =>
      db.cpEventDestination.update({ where: { id: destinationId }, data: { secretRotatedAt: new Date() } }),
    );
    await this.recordAudit(scope, actor, destinationId, "secret_rotated", "info", "Webhook signing secret rotated", { previousSecretExpiresAt: expiresAt });
    return { ...updated, signingSecret, previousSecretExpiresAt: current ? expiresAt : null };
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
   * Stops treating the destination as configured. A webhook's delivery service then drops its
   * events; a Pub/Sub subscription is left for the operator to delete after draining, so no
   * in-flight event is dropped silently.
   */
  async disable(scope: EnvironmentScope, destinationId: string, actor: string) {
    const found = await this.find(scope, destinationId);
    if (found.transport === "webhook") {
      const config = await this.webhooks.read(destinationId);
      if (config) await this.webhooks.write(destinationId, { ...config, disabled: true });
    }
    const destination = await withTenant(this.prisma, { organizationId: scope.organizationId }, (db) =>
      db.cpEventDestination.update({ where: { id: destinationId }, data: { status: "disabled" } }),
    );
    await this.recordAudit(scope, actor, destinationId, "disabled", "warning", "Payment event destination disabled; delete its Pub/Sub subscription after draining", {
      subscriptionName: destination.subscriptionName,
    });
    return destination;
  }

  /** Validates the environment, application and payments capability, then inserts a provisioning row. */
  private async prepare(
    scope: EnvironmentScope,
    recipientApplicationId: string,
    id: string,
    row: { transport: string; pushEndpoint: string; oidcAudience: string | null; deliveryServiceAccountEmail: string; webhookUrl?: string },
    actor: string,
  ) {
    return withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await db.cpEnvironment.findFirst({
        where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
      });
      if (!environment) throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
      await assertControlPlaneAuthority(db, scope.projectId, scope.environmentKind);
      const application = await db.cpApplication.findFirst({
        where: { id: recipientApplicationId, organizationId: scope.organizationId, environmentId: environment.id },
      });
      if (!application) throw new NotFoundError(`Application '${recipientApplicationId}' was not found in this environment`);
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
          id,
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          environmentId: environment.id,
          recipientApplicationId: application.id,
          ...row,
          createdBy: actor,
        },
      });
      return { destination, ownerGroupId: owner?.ownerGroupId ?? scope.organizationId };
    });
  }

  /** Provisions the filtered Pub/Sub subscription and records whether it worked. */
  private async provision(
    scope: EnvironmentScope,
    prepared: { destination: { id: string; recipientApplicationId: string }; ownerGroupId: string },
    delivery: Delivery,
    actor: string,
  ) {
    let status: "active" | "failed" = "active";
    let subscriptionName: string | null = null;
    let lastError: string | null = null;
    try {
      const result = await this.provisioner.provision({
        ownerTribeId: prepared.ownerGroupId,
        consumerServiceId: prepared.destination.recipientApplicationId,
        environment: scope.environmentKind,
        endpointEnvironment: scope.environmentKind,
        pushEndpoint: delivery.pushEndpoint,
        ...(delivery.oidcAudience ? { oidcAudience: delivery.oidcAudience } : {}),
        deliveryServiceAccountEmail: delivery.deliveryServiceAccountEmail,
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
    await this.recordAudit(scope, actor, destination.id, status, status === "active" ? "info" : "error", `Payment event destination ${status}`, {
      recipientApplicationId: prepared.destination.recipientApplicationId,
      transport: destination.transport,
      subscriptionName,
    });
    return destination;
  }

  private async find(scope: EnvironmentScope, destinationId: string) {
    const found = await withTenant(this.prisma, { organizationId: scope.organizationId }, (db) =>
      db.cpEventDestination.findFirst({ where: { id: destinationId, organizationId: scope.organizationId, projectId: scope.projectId } }),
    );
    if (!found) throw new NotFoundError(`Event destination '${destinationId}' was not found`);
    return found;
  }

  private recordAudit(
    scope: EnvironmentScope,
    actor: string,
    destinationId: string,
    outcome: string,
    severity: "info" | "warning" | "error",
    message: string,
    payload: Record<string, unknown>,
  ) {
    return this.audit.record({
      type: `control_plane.event_destination.${outcome}`,
      actionFamily: "runtime",
      actor,
      resourceType: "cp_event_destination",
      resourceId: destinationId,
      environment: scope.environmentKind,
      severity,
      message,
      payload,
    });
  }
}

/** The delivery service URL and the service account Pub/Sub uses to call it. */
function webhookDeliveryTarget(env: NodeJS.ProcessEnv = process.env) {
  const url = env.WEBHOOK_DELIVERY_URL?.trim().replace(/\/+$/, "");
  const pushServiceAccount = env.WEBHOOK_PUSH_SERVICE_ACCOUNT?.trim();
  if (!url || !pushServiceAccount) {
    throw new AppError("Webhook delivery is not configured (WEBHOOK_DELIVERY_URL, WEBHOOK_PUSH_SERVICE_ACCOUNT)", 503, "WEBHOOKS_NOT_CONFIGURED");
  }
  return { url, pushServiceAccount };
}
