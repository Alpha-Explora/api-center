"use client";

import dynamic from "next/dynamic";

export const ContractTesterPanel = dynamic(() =>
  import("@/components/contract-tester-panel").then(
    (module) => module.ContractTesterPanel,
  ),
);

export const EventMappingPanel = dynamic(() =>
  import("@/components/event-mapping-panel").then(
    (module) => module.EventMappingPanel,
  ),
);

export const OnboardingChecklistPanel = dynamic(() =>
  import("@/components/onboarding-checklist-panel").then(
    (module) => module.OnboardingChecklistPanel,
  ),
);

export const SharedServiceObservabilityPanel = dynamic(() =>
  import("@/components/shared-service-observability-panel").then(
    (module) => module.SharedServiceObservabilityPanel,
  ),
);

export const TribeSecretHealthPanel = dynamic(() =>
  import("@/components/secret-health-panel").then(
    (module) => module.TribeSecretHealthPanel,
  ),
);

export const SdkConfigPanel = dynamic(() =>
  import("@/components/sdk-config-panel").then((module) => module.SdkConfigPanel),
);

export const ServiceTimelinePanel = dynamic(() =>
  import("@/components/service-timeline-panel").then(
    (module) => module.ServiceTimelinePanel,
  ),
);

export const TribeOnboardingFlow = dynamic(() =>
  import("@/components/tribe-onboarding-flow").then(
    (module) => module.TribeOnboardingFlow,
  ),
);

export const TribeOnboardingPacketPanel = dynamic(() =>
  import("@/components/tribe-onboarding-packet-panel").then(
    (module) => module.TribeOnboardingPacketPanel,
  ),
);

export const TribeObservabilityPanel = dynamic(() =>
  import("@/components/tribe-observability-panel").then(
    (module) => module.TribeObservabilityPanel,
  ),
);

export const ServiceActionsPanel = dynamic(() =>
  import("@/components/service-detail/service-actions-panel").then(
    (module) => module.ServiceActionsPanel,
  ),
);

export const ServiceIdentityPanel = dynamic(() =>
  import("@/components/service-detail/service-identity-panel").then(
    (module) => module.ServiceIdentityPanel,
  ),
);

export const ServicePipelinePanel = dynamic(() =>
  import("@/components/service-detail/service-pipeline-panel").then(
    (module) => module.ServicePipelinePanel,
  ),
);

export const TribeSecretRotationWorkflow = dynamic(() =>
  import("@/components/tribe-secret-card").then(
    (module) => module.TribeSecretRotationWorkflow,
  ),
);
