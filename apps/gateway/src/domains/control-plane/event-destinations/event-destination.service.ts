// Event destinations: one recipient application's payment events in one environment.
//
// The application's event subscription pushes to APICenter's delivery service. It signs each event
// and delivers it to the configured HTTPS URL. Signing secrets stay in Secret Manager.

import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { PaymentPubSubProvisioningService } from "@payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";
import { AppError, ConflictError, NotFoundError } from "@shared/errors";
import { assertPublicUpstream, upstreamGuardOptions } from "@shared/proxy/upstream-guard";
import { newResourceId } from "../application-credential";
import { withTenant, type TenantDb, type TenantTransactionOptions } from "../tenant-transaction";
import type { EnvironmentScope } from "../control-plane-admin.service";
import { newSigningSecret, WEBHOOK_CONFIG_STORE, type WebhookConfigStore, type WebhookDestinationConfig } from "./webhook-config-store";
import { normalizeEventTypes } from "./event-types";

export interface WebhookInput {
  recipientApplicationId: string;
  url: string;
  /** Event types to deliver; empty or missing delivers every type. */
  eventTypes?: string[];
}

/** How long a rotated-out signing secret keeps signing, so consumers can switch without a gap. */
export const ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;

type Delivery = { pushEndpoint: string; oidcAudience?: string; deliveryServiceAccountEmail: string };
type DestinationRow = NonNullable<Awaited<ReturnType<TenantDb["cpEventDestination"]["findFirst"]>>>;

/** Room for a Secret Manager read and write while a destination's lock is held. */
const WEBHOOK_CONFIG_TRANSACTION: TenantTransactionOptions = { timeoutMs: 30_000, maxWaitMs: 10_000 };

@Injectable()
export class EventDestinationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioner: PaymentPubSubProvisioningService,
    private readonly audit: AuditEventsService,
    @Inject(WEBHOOK_CONFIG_STORE) private readonly webhooks: WebhookConfigStore,
  ) {}

  /**
   * Creates a signed-webhook destination and returns its signing secret, which is shown only once.
   * The secret is stored before the subscription exists, so no event can arrive unsigned.
   */
  async createWebhook(scope: EnvironmentScope, input: WebhookInput, actor: string) {
    const eventTypes = normalizeEventTypes(input.eventTypes ?? []);
    const url = (await assertPublicUpstream(input.url, upstreamGuardOptions())).toString();
    const delivery = webhookDeliveryTarget();
    const id = newResourceId("dst");
    const pushEndpoint = `${delivery.url}/deliveries/${id}`;
    const prepared = await this.prepare(scope, input.recipientApplicationId, id, {
      transport: "webhook",
      webhookUrl: url,
      eventTypes,
      pushEndpoint,
      oidcAudience: delivery.url,
      deliveryServiceAccountEmail: delivery.pushServiceAccount,
    }, actor);
    const signingSecret = newSigningSecret();
    try {
      await this.webhooks.write(id, withEventTypes({ url, secrets: [{ value: signingSecret }] }, eventTypes));
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
    const signingSecret = newSigningSecret();
    const expiresAt = new Date(Date.now() + ROTATION_OVERLAP_MS).toISOString();
    const { updated, current } = await this.withConfigLock(scope, destinationId, async (db, destination) => {
      if (destination.transport !== "webhook") throw new AppError("Only webhook destinations have a signing secret", 409, "NOT_A_WEBHOOK");
      if (destination.status === "disabled") throw new ConflictError("This destination is disabled");
      const config = await this.readWebhookConfig(destinationId);
      const current = config.secrets.find((secret) => !secret.expiresAt);
      await this.webhooks.write(destinationId, {
        ...config,
        secrets: [{ value: signingSecret }, ...(current ? [{ value: current.value, expiresAt }] : [])],
      });
      const updated = await db.cpEventDestination.update({ where: { id: destinationId }, data: { secretRotatedAt: new Date() } });
      return { updated, current };
    });
    await this.recordAudit(scope, actor, destinationId, "secret_rotated", "info", "Webhook signing secret rotated", { previousSecretExpiresAt: expiresAt });
    return { ...updated, signingSecret, previousSecretExpiresAt: current ? expiresAt : null };
  }

  /**
   * Changes which event types a webhook delivers; an empty list delivers every type. The delivery
   * service applies it, so it takes effect within its config cache (about 30 seconds). A Pub/Sub
   * push destination cannot be filtered: Pub/Sub never changes a subscription's filter.
   */
  async setEventTypes(scope: EnvironmentScope, destinationId: string, requested: string[], actor: string) {
    const eventTypes = normalizeEventTypes(requested);
    const { updated, before } = await this.withConfigLock(scope, destinationId, async (db, destination) => {
      if (destination.transport !== "webhook") {
        throw new AppError(
          "Only webhook destinations can filter event types; a Pub/Sub push endpoint can filter on the eventType attribute",
          409,
          "EVENT_FILTER_UNSUPPORTED",
        );
      }
      if (destination.status === "disabled") throw new ConflictError("This destination is disabled");
      const config = await this.readWebhookConfig(destinationId);
      await this.webhooks.write(destinationId, withEventTypes(config, eventTypes));
      const updated = await db.cpEventDestination.update({ where: { id: destinationId }, data: { eventTypes } });
      return { updated, before: destination.eventTypes ?? [] };
    });
    await this.recordAudit(scope, actor, destinationId, "event_types_changed", "info", "Webhook event types changed", {
      before,
      after: eventTypes,
    });
    return updated;
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
    const destination = await this.withConfigLock(scope, destinationId, async (db, found) => {
      if (found.transport === "webhook") {
        const config = await this.webhooks.read(destinationId);
        if (config) await this.webhooks.write(destinationId, { ...config, disabled: true });
      }
      return db.cpEventDestination.update({ where: { id: destinationId }, data: { status: "disabled" } });
    });
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
    row: {
      transport: string;
      pushEndpoint: string;
      oidcAudience: string | null;
      deliveryServiceAccountEmail: string;
      webhookUrl?: string;
      eventTypes?: string[];
    },
    actor: string,
  ) {
    return withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await db.cpEnvironment.findFirst({
        where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
      });
      if (!environment) throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
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

  /**
   * Runs a change to a destination under a transaction lock on it. Each webhook change reads the
   * whole Secret Manager config and writes it back, so without the lock a concurrent rotation,
   * filter edit or disable could overwrite another's version and drop a newly issued signing
   * secret. The destination is read under the lock, so `work` sees the previous change's status.
   */
  private withConfigLock<T>(scope: EnvironmentScope, destinationId: string, work: (db: TenantDb, destination: DestinationRow) => Promise<T>) {
    return withTenant(
      this.prisma,
      { organizationId: scope.organizationId },
      async (db) => {
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cp_event_destination:${destinationId}`}, 0))`;
        // The destination in this exact environment; a test path never reaches a live destination.
        const environment = await db.cpEnvironment.findFirst({
          where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
        });
        const destination = environment
          ? await db.cpEventDestination.findFirst({
              where: { id: destinationId, organizationId: scope.organizationId, projectId: scope.projectId, environmentId: environment.id },
            })
          : null;
        if (!destination) throw new NotFoundError(`Event destination '${destinationId}' was not found`);
        return work(db, destination);
      },
      WEBHOOK_CONFIG_TRANSACTION,
    );
  }

  private async readWebhookConfig(destinationId: string): Promise<WebhookDestinationConfig> {
    const config = await this.webhooks.read(destinationId);
    if (!config) throw new AppError("This webhook's configuration is missing; create the destination again", 409, "WEBHOOK_CONFIG_MISSING");
    return config;
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
      organizationId: scope.organizationId,
      projectId: scope.projectId,
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

/** The config with its event-type filter set; an empty filter is left out, which delivers every type. */
function withEventTypes(config: WebhookDestinationConfig, eventTypes: string[]): WebhookDestinationConfig {
  const rest = { ...config };
  delete rest.eventTypes;
  return eventTypes.length ? { ...rest, eventTypes } : rest;
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
