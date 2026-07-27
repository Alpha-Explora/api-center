import {
  ContractTesterPanel,
  EventMappingPanel,
  OnboardingChecklistPanel,
  SdkConfigPanel,
  ServiceActionsPanel,
  ServiceIdentityPanel,
  ServicePipelinePanel,
  ServiceTimelinePanel,
  SharedServiceObservabilityPanel,
  TribeObservabilityPanel,
  TribeOnboardingFlow,
  TribeOnboardingPacketPanel,
  TribeSecretHealthPanel,
} from "@/components/service-detail/service-detail-sections";
import { SectionHeader } from "@/components/service-detail/section-header";
import { StatusSummaryCard } from "@/components/service-detail/summary-section";
import { ServiceEnvironmentPanel } from "@/components/service-detail/environment-section";
import {
  GovernancePostureCard,
  LifecycleEvidenceRouteMap,
  ServiceLifecycleCommandMap,
} from "@/components/service-detail/lifecycle-section";
import { DependenciesCard } from "@/components/service-detail/dependencies-section";
import { QuotaPostureCard } from "@/components/service-detail/quota-section";
import { TribeSecretProvisionCard } from "@/components/service-detail/tribe-secret-provision-card";
import { ManifestExportPanel } from "@/components/service-detail/manifest-export-panel";
import type { DetailSection } from "@/components/service-detail/service-detail-navigation";
import type { OperationPreview } from "@/lib/api-center-client";
import type {
  PipelineAthenaCostRow,
  PipelineDecisionSignalRow,
  PipelineGatewayDecisionRow,
  PipelineHealthRow,
  PipelineQualityRow,
  PipelineSharedServiceUsageRow,
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceHealthResult,
  ServiceRegistryEntry,
} from "@/lib/schemas";
import type { ServiceLifecycleEntry } from "@/lib/service-lifecycle";
import type { RuntimeEnvironment } from "@/lib/environment-names";
import { Button } from "@/components/ui/button";

type BrokenDependency = {
  sourceServiceId: string;
  targetServiceId: string;
};

type PipelineSectionState = {
  environment: RuntimeEnvironment;
  partitionValue: string;
  healthRows: PipelineHealthRow[];
  healthLoading: boolean;
  qualityRows: PipelineQualityRow[];
  sharedServiceUsageRows: PipelineSharedServiceUsageRow[];
  gatewayDecisionRows: PipelineGatewayDecisionRow[];
  decisionSignalRows: PipelineDecisionSignalRow[];
  costRows: PipelineAthenaCostRow[];
  governanceLoading: boolean;
  onEnvironmentChange: (environment: RuntimeEnvironment) => void;
  onPartitionValueChange: (value: string) => void;
};

type SecretActionState = {
  plaintextSecret: string;
  secretHash: string;
  provisionedSecret: { secretName: string; versionName: string } | null;
  manualCopy: { label: string; value: string } | null;
  pending: boolean;
  operationPreview: OperationPreview | null;
  previewPending: boolean;
  typedPhrase: string;
  operatorReason: string;
  environment: "test" | "live";
  onGenerate: () => void;
  onCopy: () => void;
  onProvision: () => void;
  onPreview: () => void;
  onEnvironmentChange: (value: "test" | "live") => void;
  onTypedPhraseChange: (value: string) => void;
  onOperatorReasonChange: (value: string) => void;
};

type LifecycleActionState = {
  activatePending: boolean;
  deprecatePending: boolean;
  retirePending: boolean;
  deregisterPending: boolean;
  onActivate: () => void;
  onDeprecate: () => void;
  onRetire: () => void;
  onDeregister: () => void;
  onDeregistered: () => void;
};

type ServiceDetailContentProps = {
  activeSection: DetailSection;
  service: ServiceRegistryEntry;
  services: ServiceRegistryEntry[];
  isTribe: boolean;
  tribePrincipalId: string;
  consumers: string[];
  brokenDependencies: BrokenDependency[];
  lifecycleEntry?: ServiceLifecycleEntry;
  healthResult: ServiceHealthResult | null;
  healthPending: boolean;
  onCheckHealth: () => void;
  quotaPolicies: QuotaPolicy[];
  quotaUsage: QuotaUsageDecision[];
  quotaLoading: boolean;
  pipeline: PipelineSectionState;
  secret: SecretActionState;
  lifecycleActions: LifecycleActionState;
};

export function ServiceDetailContent({
  activeSection,
  service,
  services,
  isTribe,
  tribePrincipalId,
  consumers,
  brokenDependencies,
  lifecycleEntry,
  healthResult,
  healthPending,
  onCheckHealth,
  quotaPolicies,
  quotaUsage,
  quotaLoading,
  pipeline,
  secret,
  lifecycleActions,
}: ServiceDetailContentProps) {
  if (activeSection === "summary") {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Current issue"
          description="The strongest service-level signal and the next operational choice."
        />
        <StatusSummaryCard
          service={service}
          brokenDependencyCount={brokenDependencies.length}
          consumerCount={consumers.length}
        />
        <ServiceEnvironmentPanel service={service} />
        {lifecycleEntry ? (
          <ServiceLifecycleCommandMap entry={lifecycleEntry} />
        ) : null}
        <ServiceIdentityPanel
          service={service}
          healthResult={healthResult}
          healthPending={healthPending}
          onCheckHealth={onCheckHealth}
        />
        <OnboardingChecklistPanel service={service} services={services} />
      </div>
    );
  }

  if (activeSection === "health") {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Service health"
          description="Runtime checks, ownership, and verification controls for this service."
        />
        <ServiceIdentityPanel
          service={service}
          healthResult={healthResult}
          healthPending={healthPending}
          onCheckHealth={onCheckHealth}
        />
        <ServiceEnvironmentPanel service={service} />
        <ContractTesterPanel service={service} />
        {isTribe ? <TribeSecretHealthPanel serviceId={tribePrincipalId} /> : null}
      </div>
    );
  }

  if (activeSection === "dependencies") {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Dependency impact"
          description="Direct consumers, dependencies, and unresolved service links."
        />
        <DependenciesCard
          service={service}
          services={services}
          consumers={consumers}
          brokenDependencies={brokenDependencies}
        />
        {isTribe ? (
          <TribeObservabilityPanel service={service} services={services} />
        ) : (
          <SharedServiceObservabilityPanel
            service={service}
            services={services}
            consumers={consumers}
          />
        )}
      </div>
    );
  }

  if (activeSection === "quotas") {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Quota posture"
          description="Quota readiness for this service and its consuming teams."
        />
        <QuotaPostureCard
          service={service}
          consumerCount={consumers.length}
          policies={quotaPolicies}
          usage={quotaUsage}
          loading={quotaLoading}
        />
      </div>
    );
  }

  if (activeSection === "pipeline") {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Pipeline posture"
          description="Event ingestion, data quality, gateway decisions, and data cost signals."
        />
        {isTribe ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={pipeline.environment === "test" ? "default" : "outline"}
                onClick={() => pipeline.onEnvironmentChange("test")}
              >
                Test
              </Button>
              <Button
                type="button"
                variant={pipeline.environment === "live" ? "default" : "outline"}
                onClick={() => pipeline.onEnvironmentChange("live")}
              >
                Live
              </Button>
              <input
                aria-label="Pipeline partition date"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                type="date"
                value={pipeline.partitionValue}
                onChange={(event) =>
                  pipeline.onPartitionValueChange(event.target.value)
                }
              />
            </div>
            <ServicePipelinePanel
              service={service}
              mode="observability"
              pipelineHealthRows={pipeline.healthRows}
              pipelineHealthLoading={pipeline.healthLoading}
              qualityRows={pipeline.qualityRows}
              sharedServiceUsageRows={pipeline.sharedServiceUsageRows}
              gatewayDecisionRows={pipeline.gatewayDecisionRows}
              decisionSignalRows={pipeline.decisionSignalRows}
              costRows={pipeline.costRows}
              governanceLoading={pipeline.governanceLoading}
            />
          </>
        ) : (
          <SharedServiceObservabilityPanel
            service={service}
            services={services}
            consumers={consumers}
          />
        )}
      </div>
    );
  }

  if (activeSection === "governance") {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Governance posture"
          description="Promotion readiness, ownership, contract evidence, and operational trust."
        />
        <GovernancePostureCard service={service} lifecycleEntry={lifecycleEntry} />
        <TribeOnboardingPacketPanel service={service} />
        <EventMappingPanel service={service} />
      </div>
    );
  }

  if (activeSection === "evidence") {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Evidence timeline"
          description="Recent registry, runtime, and data-pipeline evidence for this service."
        />
        {lifecycleEntry ? (
          <LifecycleEvidenceRouteMap entry={lifecycleEntry} />
        ) : null}
        <ServiceTimelinePanel service={service} />
        <EventMappingPanel service={service} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Safe actions"
        description="Preview, export, rotate, and lifecycle controls that require deliberate confirmation."
      />
      {isTribe ? (
        <>
          <TribeOnboardingFlow
            serviceId={service.serviceId}
            ownerTribeId={service.ownerTribeId}
            consumes={service.consumes}
            healthCheck={service.healthCheck}
            ownerTeam={service.ownerTeam}
            contact={service.contact}
            requiredScopes={service.requiredScopes}
          />
          <TribeSecretProvisionCard
            serviceId={tribePrincipalId}
            environment={secret.environment}
            plaintextSecret={secret.plaintextSecret}
            secretHash={secret.secretHash}
            provisionedSecret={secret.provisionedSecret}
            manualCopy={secret.manualCopy}
            pending={secret.pending}
            onGenerate={secret.onGenerate}
            onCopy={secret.onCopy}
            onProvision={secret.onProvision}
            operationPreview={secret.operationPreview}
            previewPending={secret.previewPending}
            onPreview={secret.onPreview}
            typedPhrase={secret.typedPhrase}
            operatorReason={secret.operatorReason}
            onEnvironmentChange={secret.onEnvironmentChange}
            onTypedPhraseChange={secret.onTypedPhraseChange}
            onOperatorReasonChange={secret.onOperatorReasonChange}
          />
        </>
      ) : (
        <SdkConfigPanel service={service} />
      )}
      <ServiceActionsPanel
        service={service}
        consumers={consumers}
        activatePending={lifecycleActions.activatePending}
        deprecatePending={lifecycleActions.deprecatePending}
        retirePending={lifecycleActions.retirePending}
        deregisterPending={lifecycleActions.deregisterPending}
        onActivate={lifecycleActions.onActivate}
        onDeprecate={lifecycleActions.onDeprecate}
        onRetire={lifecycleActions.onRetire}
        onDeregister={lifecycleActions.onDeregister}
        onDeregistered={lifecycleActions.onDeregistered}
      />
      <ManifestExportPanel service={service} />
    </div>
  );
}
