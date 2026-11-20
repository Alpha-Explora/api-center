// Test recipients: who a project's test environment may really deliver email, SMS and OTP to.
// A test send to anyone else still succeeds and is recorded, but the gateway marks its signed
// runtime context so the runtime never calls Twilio or Resend. Test keys therefore cannot message
// arbitrary people from APICenter's provider accounts.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@shared/errors";
import { withTenant, type TenantDb } from "./tenant-transaction";

export const MAX_TEST_RECIPIENTS = 50;

const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The stored form: E.164 without separators, or a lower-case email. Undefined when neither. */
export function normalizeRecipient(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return email.length <= 254 && EMAIL.test(email) ? email : undefined;
  }
  const phone = value.replace(/[\s().-]/g, "");
  return E164.test(phone) ? phone : undefined;
}

/**
 * The recipients a capability request would deliver to, or undefined when it delivers nothing
 * (status reads, OTP verification, other capabilities).
 */
export function deliveryRecipients(capability: string, method: string, relativePath: string, body: unknown): string[] | undefined {
  if (method.toUpperCase() !== "POST") return undefined;
  const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const path = relativePath.replace(/\/$/, "");
  if ((capability === "email" || capability === "sms") && path === "/send") {
    const to = fields.to;
    return (Array.isArray(to) ? to : [to]).map((value) => String(value ?? ""));
  }
  if (capability === "otp" && path === "/generate") return [String(fields.recipient ?? fields.target ?? "")];
  return undefined;
}

@Injectable()
export class TestRecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventsService,
  ) {}

  async list(organizationId: string, projectId: string) {
    return withTenant(this.prisma, { organizationId }, async (db) => {
      await requireProject(db, organizationId, projectId);
      return db.cpTestRecipient.findMany({ where: { organizationId, projectId }, orderBy: { createdAt: "asc" } });
    });
  }

  async add(organizationId: string, projectId: string, rawRecipient: string, actor: string) {
    const recipient = normalizeRecipient(rawRecipient);
    if (!recipient) throw new ValidationError("recipient must be an E.164 phone number (+639171234567) or an email address");
    const created = await withTenant(this.prisma, { organizationId }, async (db) => {
      await requireProject(db, organizationId, projectId);
      const count = await db.cpTestRecipient.count({ where: { organizationId, projectId } });
      if (count >= MAX_TEST_RECIPIENTS) {
        throw new AppError(`A project can register at most ${MAX_TEST_RECIPIENTS} test recipients`, 409, "TEST_RECIPIENT_LIMIT");
      }
      try {
        return await db.cpTestRecipient.create({ data: { organizationId, projectId, recipient, createdBy: actor } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictError(`'${recipient}' is already a test recipient`);
        }
        throw error;
      }
    });
    await this.recordAudit(organizationId, projectId, "control_plane.test_recipient.added", actor, recipient);
    return created;
  }

  async remove(organizationId: string, projectId: string, rawRecipient: string, actor: string) {
    const recipient = normalizeRecipient(rawRecipient) ?? rawRecipient;
    await withTenant(this.prisma, { organizationId }, async (db) => {
      const removed = await db.cpTestRecipient.deleteMany({ where: { organizationId, projectId, recipient } });
      if (removed.count === 0) throw new NotFoundError(`'${recipient}' is not a test recipient`);
    });
    await this.recordAudit(organizationId, projectId, "control_plane.test_recipient.removed", actor, recipient);
    return { recipient, removed: true };
  }

  /** Whether a test send must be recorded without delivery: any recipient is not registered. */
  async shouldSuppress(organizationId: string, projectId: string, recipients: string[]): Promise<boolean> {
    const normalized = recipients.map(normalizeRecipient);
    // An unparseable recipient is the runtime's to reject; it is never delivered either way.
    if (normalized.some((value) => value === undefined)) return true;
    const registered = await withTenant(this.prisma, { organizationId }, (db) =>
      db.cpTestRecipient.count({ where: { organizationId, projectId, recipient: { in: normalized as string[] } } }),
    );
    return registered < new Set(normalized).size;
  }

  private async recordAudit(organizationId: string, projectId: string, type: string, actor: string, recipient: string) {
    await this.audit.record({
      type,
      organizationId,
      projectId,
      actionFamily: "registration",
      actor,
      resourceType: "cp_test_recipient",
      resourceId: `${projectId}:${recipient}`,
      environment: "test",
      severity: "info",
      message: type.replaceAll(".", " "),
      payload: { recipient },
    });
  }
}

async function requireProject(db: TenantDb, organizationId: string, projectId: string) {
  const project = await db.cpProject.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });
  if (!project) throw new NotFoundError(`Project '${projectId}' was not found`);
}
