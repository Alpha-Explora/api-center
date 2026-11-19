// What happened to a signed webhook's deliveries, and a way to trigger one on demand. History comes
// from the webhooks runtime; a test event goes through the same Pub/Sub topic and filtered
// subscription as real payment events, so the consumer receives a correctly signed request.

import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { AppError, BadGatewayError, NotFoundError } from "@shared/errors";
import { withTenant } from "../tenant-transaction";
import type { EnvironmentScope } from "../control-plane-admin.service";
import { WEBHOOK_DELIVERY_HISTORY, type WebhookDeliveryHistory } from "./webhook-delivery-history";
import { buildTestEvent, TEST_EVENT_TYPE, WEBHOOK_TEST_EVENT_PUBLISHER, type TestEventPublisher } from "./webhook-test-event";

@Injectable()
export class WebhookDeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventsService,
    @Inject(WEBHOOK_DELIVERY_HISTORY) private readonly history: WebhookDeliveryHistory,
    @Inject(WEBHOOK_TEST_EVENT_PUBLISHER) private readonly publisher: TestEventPublisher,
  ) {}

  /** The destination's most recent delivery attempts, newest first. */
  async list(scope: EnvironmentScope, destinationId: string, limit: number) {
    await this.findWebhook(scope, destinationId);
    return this.history.list(destinationId, limit);
  }

  /** Publishes a `webhook.test` event for an active webhook destination and returns its event ID. */
  async sendTestEvent(scope: EnvironmentScope, destinationId: string, actor: string) {
    const { destination, owner } = await this.findWebhook(scope, destinationId);
    if (destination.status !== "active") {
      throw new AppError(`This destination is ${destination.status}; only an active webhook can receive a test event`, 409, "DESTINATION_NOT_ACTIVE");
    }
    const sentAt = new Date();
    const message = buildTestEvent(
      {
        destinationId,
        environment: scope.environmentKind,
        organizationId: owner?.ownerGroupId ?? scope.organizationId,
        projectId: owner?.ownerProjectId ?? scope.projectId,
        applicationId: destination.recipientApplicationId,
      },
      sentAt,
    );
    let messageId: string;
    try {
      messageId = await this.publisher.publish(scope.environmentKind, message);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new BadGatewayError(`The test event could not be published: ${(error as Error).message}`.slice(0, 300));
    }
    await this.audit.record({
      type: "control_plane.event_destination.test_event_sent",
      actionFamily: "runtime",
      actor,
      resourceType: "cp_event_destination",
      resourceId: destinationId,
      environment: scope.environmentKind,
      severity: "info",
      message: "Webhook test event published",
      payload: { eventId: message.event.eventId, messageId, recipientApplicationId: destination.recipientApplicationId },
    });
    return { destinationId, eventId: message.event.eventId, eventType: TEST_EVENT_TYPE, messageId, sentAt: sentAt.toISOString() };
  }

  /** A webhook destination in this exact environment, with the resource owner its events carry. */
  private async findWebhook(scope: EnvironmentScope, destinationId: string) {
    const found = await withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await db.cpEnvironment.findFirst({
        where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
      });
      if (!environment) return null;
      const destination = await db.cpEventDestination.findFirst({
        where: { id: destinationId, organizationId: scope.organizationId, projectId: scope.projectId, environmentId: environment.id },
      });
      if (!destination) return null;
      const owner = await db.cpResourceOwnerMapping.findFirst({
        where: { organizationId: scope.organizationId, projectId: scope.projectId, environmentKind: scope.environmentKind },
      });
      return { destination, owner };
    });
    if (!found) throw new NotFoundError(`Event destination '${destinationId}' was not found`);
    if (found.destination.transport !== "webhook") {
      throw new AppError("Only webhook destinations have a delivery history and test events", 409, "NOT_A_WEBHOOK");
    }
    return found;
  }
}
