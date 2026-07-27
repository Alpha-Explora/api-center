type GovernanceState = {
  status: "up" | "down";
  quotaEnforcer: "up" | "down";
  policyEngine: "up" | "down";
  approvals: "up" | "down";
  imageTag: string;
  sdkContractVersion: string;
};

export function GovernanceReadinessPanel({
  governance,
}: {
  governance: GovernanceState;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Governance readiness</h2>
      <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <ReadinessItem
          label="Quota enforcer"
          value={governance.quotaEnforcer}
        />
        <ReadinessItem label="Policy engine" value={governance.policyEngine} />
        <ReadinessItem label="Approvals" value={governance.approvals} />
        <ReadinessItem label="Image" value={governance.imageTag} />
        <ReadinessItem
          label="SDK contract"
          value={governance.sdkContractVersion}
        />
      </dl>
    </section>
  );
}

function ReadinessItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
