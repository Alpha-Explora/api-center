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

  toMarkdown(packet: ReturnType<ComplianceExportService["buildPacket"]>) {
    return [
      "# APICenter Compliance Export",
      "",
      `Range: ${packet.range.from} to ${packet.range.to}`,
      "",
      `Audit events: ${packet.summary.auditEventCount}`,
      `Evidence bundles: ${packet.summary.evidenceBundleCount}`,
      "",
      "## Audit Events",
      ...packet.auditEvents.map(
        (event) => `- ${event.timestamp ?? "unknown"} ${event.type ?? "event"}`,
      ),
      "",
      "## Promotion Evidence Bundles",
      ...packet.evidenceBundles.map(
        (bundle) =>
          `- ${bundle.serviceId ?? "unknown"} ${bundle.ready ? "ready" : "not ready"}`,
      ),
    ].join("\n");
  }
}
