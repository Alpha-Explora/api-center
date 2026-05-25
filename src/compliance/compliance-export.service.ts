import { Injectable } from "@nestjs/common";

@Injectable()
export class ComplianceExportService {
  buildPacket(input: {
    from: string;
    to: string;
    auditEvents: Array<Record<string, any>>;
    evidenceBundles: Array<Record<string, any>>;
  }) {
    return {
      generatedAt: new Date().toISOString(),
      range: { from: input.from, to: input.to },
      summary: {
        auditEventCount: input.auditEvents.length,
        evidenceBundleCount: input.evidenceBundles.length,
      },
      auditEvents: input.auditEvents,
      evidenceBundles: input.evidenceBundles,
    };
  }
}
