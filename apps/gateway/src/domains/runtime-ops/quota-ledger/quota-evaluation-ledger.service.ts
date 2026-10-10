import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import {
  QuotaEvaluationEntry,
  QuotaEvaluationLedger,
  QuotaEvaluationRecord,
} from "./quota-evaluation-ledger.types";

interface QuotaEvaluationDelegate {
  create(args: { data: QuotaEvaluationEntry }): Promise<unknown>;
  findMany(args: Record<string, unknown>): Promise<QuotaEvaluationRecord[]>;
}

@Injectable()
export class QuotaEvaluationLedgerService implements QuotaEvaluationLedger {
  private readonly evaluations: QuotaEvaluationDelegate;

  constructor(prisma: PrismaService) {
    this.evaluations = (
      prisma as unknown as { quotaEvaluation: QuotaEvaluationDelegate }
    ).quotaEvaluation;
  }

  async record(entry: QuotaEvaluationEntry): Promise<void> {
    await this.evaluations.create({ data: entry });
  }

  listSince(query: {
    ownerTribeId?: string;
    projectId?: string;
    since: Date;
    limit: number;
  }): Promise<QuotaEvaluationRecord[]> {
    return this.evaluations.findMany({
      where: {
        ...(query.ownerTribeId ? { ownerTribeId: query.ownerTribeId } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        createdAt: { gte: query.since },
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });
  }
}
