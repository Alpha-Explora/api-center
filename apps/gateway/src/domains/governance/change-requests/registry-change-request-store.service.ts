import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import {
  NewRegistryChangeRequest,
  RegistryChangeRequestRecord,
  RegistryChangeRequestStore,
} from "./registry-change-request.types";

@Injectable()
export class RegistryChangeRequestStoreService implements RegistryChangeRequestStore {
  constructor(private readonly prisma: PrismaService) {}

  create(input: NewRegistryChangeRequest): Promise<RegistryChangeRequestRecord> {
    return this.prisma.registryChangeRequest.create({
      data: {
        serviceId: input.serviceId,
        ownerTribeId: input.ownerTribeId,
        projectId: input.projectId,
        status: "pending",
        manifest: input.manifest as any,
        validationReport: input.validationReport as any,
        requestedBy: input.requestedBy,
      },
    });
  }

  list(status?: string): Promise<RegistryChangeRequestRecord[]> {
    return this.prisma.registryChangeRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  find(id: string): Promise<RegistryChangeRequestRecord | null> {
    return this.prisma.registryChangeRequest.findUnique({ where: { id } });
  }

  async saveValidationReport(id: string, validationReport: unknown): Promise<void> {
    await this.prisma.registryChangeRequest.update({
      where: { id },
      data: { validationReport: validationReport as any },
    });
  }

  markApplied(
    id: string,
    applied: { approvedBy: string; appliedServiceId: string; validationReport: unknown },
  ): Promise<RegistryChangeRequestRecord> {
    return this.prisma.registryChangeRequest.update({
      where: { id },
      data: {
        status: "applied",
        approvedBy: applied.approvedBy,
        appliedServiceId: applied.appliedServiceId,
        validationReport: applied.validationReport as any,
        decidedAt: new Date(),
        appliedAt: new Date(),
      },
    });
  }

  async rejectIfPending(
    id: string,
    rejection: { rejectedBy: string; reason: string },
  ): Promise<boolean> {
    const result = await this.prisma.registryChangeRequest.updateMany({
      where: { id, status: "pending" },
      data: {
        status: "rejected",
        rejectedBy: rejection.rejectedBy,
        rejectionReason: rejection.reason,
        decidedAt: new Date(),
      },
    });
    return result.count > 0;
  }
}
