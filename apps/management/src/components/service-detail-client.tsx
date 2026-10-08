"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  activateService,
  checkServiceHealth,
  deprecateService,
  deregisterService,
  getPlatformLifecycleEvidence,
  getQuotaUsage,
  getService,
  listQuotaPolicies,
  listServices,
  previewTribeSecretProvision,
  provisionTribeSecret,
  retireService,
  type OperationPreview,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import {
  getBrokenDependencies,
  getConsumersForService,
} from "@/lib/registry-view";
import {
  normalizeSection,
  type DetailSection,
} from "@/components/service-detail/service-detail-navigation";
import { ServiceDetailShell } from "@/components/service-detail/service-detail-shell";
import { ServiceDetailContent } from "@/components/service-detail/service-detail-content";
import {
  currentUtcDateInput,
  dateInputToPartition,
} from "@/components/service-detail/pipeline-date";
import { useServiceDetailPipelineQueries } from "@/components/service-detail/use-service-detail-pipeline-queries";
import {
  copyText,
  generateRandomSecret,
  sha256Hex,
  showMutationError,
} from "@/components/service-detail/service-detail-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  ServiceHealthResult,
  ServiceRegistryEntry,
} from "@/lib/schemas";
import type { RuntimeEnvironment } from "@/lib/environment-names";
import { buildServiceLifecycle } from "@/lib/service-lifecycle";

export function ServiceDetailClient({
  serviceId,
  initialSection,
}: {
  serviceId: string;
  initialSection?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [healthResult, setHealthResult] = useState<ServiceHealthResult | null>(
    null,
  );
  const [plaintextSecret, setPlaintextSecret] = useState("");
  const [secretHash, setSecretHash] = useState("");
  const [provisionedSecret, setProvisionedSecret] = useState<{
    secretName: string;
    versionName: string;
    rotatedAt: string;
  } | null>(null);
  const [manualCopy, setManualCopy] = useState<{
    label: string;
    value: string;
  } | null>(null);
  const [secretPreview, setSecretPreview] = useState<OperationPreview | null>(
    null,
  );
  const [secretTypedPhrase, setSecretTypedPhrase] = useState("");
  const [secretOperatorReason, setSecretOperatorReason] = useState("");
  const [secretEnvironment, setSecretEnvironment] =
    useState<"test" | "live">("test");
  const [pipelineHealthEnvironment, setPipelineHealthEnvironment] =
    useState<RuntimeEnvironment>("test");
  const [pipelinePartitionValue, setPipelinePartitionValue] =
    useState(currentUtcDateInput());
  const pipelinePartition = dateInputToPartition(pipelinePartitionValue);
  const pipelinePartitionKey = pipelinePartition
    ? `${pipelinePartition.year}-${pipelinePartition.month}-${pipelinePartition.day}`
    : "current";
  const section = normalizeSection(
    searchParams.get("section") ?? initialSection,
  );

  const serviceQuery = useQuery({
    queryKey: queryKeys.service(serviceId),
    queryFn: () => getService(serviceId),
  });

  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });
  const lifecycleQuery = useQuery({
    queryKey: queryKeys.platformLifecycle,
    queryFn: getPlatformLifecycleEvidence,
    retry: false,
  });
  const {
    pipelineHealthQuery,
    pipelineQualityQuery,
    pipelineSharedServiceUsageQuery,
    pipelineGatewayDecisionQuery,
    pipelineCostQuery,
    pipelineDecisionSignalQuery,
  } = useServiceDetailPipelineQueries({
    service: serviceQuery.data,
    section,
    environment: pipelineHealthEnvironment,
    partition: pipelinePartition,
    partitionKey: pipelinePartitionKey,
  });
  // Credentials belong to the service itself; quotas belong to its project and tribe.
  const credentialServiceId = serviceId;
  const ownerTribeId = serviceQuery.data?.ownerTribeId ?? "";
  const projectId = serviceQuery.data?.projectId;
  const quotaPoliciesQuery = useQuery({
    queryKey: queryKeys.applicableQuotaPolicies(ownerTribeId, projectId),
    queryFn: async () =>
      (await listQuotaPolicies(ownerTribeId)).filter(
        (policy) => !policy.projectId || policy.projectId === projectId,
      ),
    enabled: Boolean(serviceQuery.data?.ownerTribeId) && section === "quotas",
    retry: 1,
  });
  const quotaUsageQuery = useQuery({
    queryKey: queryKeys.quotaUsage(ownerTribeId, "24h"),
    queryFn: () => getQuotaUsage({ ownerTribeId, window: "24h" }),
    enabled: Boolean(serviceQuery.data?.ownerTribeId) && section === "quotas",
    retry: 1,
  });

  const consumers = useMemo(
    () => getConsumersForService(servicesQuery.data ?? [], serviceId),
    [serviceId, servicesQuery.data],
  );

  const brokenDependencies = useMemo(
    () =>
      getBrokenDependencies(servicesQuery.data ?? []).filter(
        (dependency) => dependency.sourceServiceId === serviceId,
      ),
    [serviceId, servicesQuery.data],
  );
  const lifecycleEntry = useMemo(() => {
    const service = serviceQuery.data;
    if (!service) return undefined;

    const sourceEntry = lifecycleQuery.data?.entries.find(
      (entry) => entry.service.serviceId === serviceId,
    );
    if (sourceEntry) return sourceEntry;

    return buildServiceLifecycle({
      service,
      services: servicesQuery.data ?? [service],
      quotaPolicies: [],
      quotaUsage: [],
    });
  }, [lifecycleQuery.data?.entries, serviceId, serviceQuery.data, servicesQuery.data]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.services });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.service(serviceId),
    });
  };

  function selectSection(nextSection: DetailSection) {
    router.replace(
      `/tribes/${encodeURIComponent(serviceId)}?section=${nextSection}`,
      { scroll: false },
    );
  }

  const activateMutation = useMutation({
    mutationFn: () => activateService(serviceId),
    onSuccess: async () => {
      toast.success("Service activated");
      await refresh();
    },
    onError: showMutationError("Activation failed"),
  });

  const deprecateMutation = useMutation({
    mutationFn: () => deprecateService(serviceId, {}),
    onSuccess: async () => {
      toast.success("Service deprecated");
      await refresh();
    },
    onError: showMutationError("Deprecation failed"),
  });

  const healthMutation = useMutation({
    mutationFn: () => checkServiceHealth(serviceId),
    onSuccess: (result) => {
      setHealthResult(result);
      toast[result.ok ? "success" : "error"](
        result.ok ? "Health check passed" : "Health check failed",
      );
    },
    onError: showMutationError("Health check failed"),
  });

  const provisionSecretMutation = useMutation({
    mutationFn: () =>
      provisionTribeSecret({
        serviceId: credentialServiceId,
        environment: secretEnvironment,
        secretHashSha256: secretHash,
        mode: "create-or-rotate",
        confirmation: {
          typedPhrase: secretTypedPhrase,
          reason: secretOperatorReason,
        },
      }),
    onSuccess: (result) => {
      setProvisionedSecret({
        secretName: result.secretName,
        versionName: result.versionName,
        rotatedAt: result.rotatedAt,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tribeSecretStatus(credentialServiceId, secretEnvironment),
      });
      toast.success("Service secret provisioned");
    },
    onError: showMutationError(
      "Secret provisioning failed",
      "Check local gcloud impersonation for the management provisioner service account.",
    ),
  });

  const previewSecretMutation = useMutation({
    mutationFn: () =>
      previewTribeSecretProvision({
        serviceId: credentialServiceId,
        environment: secretEnvironment,
        secretHashSha256: secretHash,
        mode: "create-or-rotate",
      }),
    onSuccess: (preview) => {
      setSecretPreview(preview);
      toast.success("Secret operation preview loaded");
    },
    onError: showMutationError(
      "Secret preview failed",
      "Check management auth and generated secret hash.",
    ),
  });

  const generateTribeSecret = async () => {
    const generated = generateRandomSecret();
    setPlaintextSecret(generated);
    setSecretHash(await sha256Hex(generated));
    setProvisionedSecret(null);
    toast.success("Plaintext secret generated");
  };

  const copyPlaintextSecret = async () => {
    if (!plaintextSecret) return;
    await copyText(
      plaintextSecret,
      "Plaintext secret copied",
      "plaintext service secret",
      setManualCopy,
    );
  };

  const retireMutation = useMutation({
    mutationFn: () => retireService(serviceId),
    onSuccess: async () => {
      toast.success("Service retired");
      await refresh();
    },
    onError: showMutationError("Retire failed"),
  });

  const deregisterMutation = useMutation({
    mutationFn: () => deregisterService(serviceId),
    onSuccess: async () => {
      toast.success("Service deregistered");
      await queryClient.invalidateQueries({ queryKey: queryKeys.services });
      router.push("/tribes");
    },
    onError: showMutationError("Deregister failed"),
  });

  if (serviceQuery.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (serviceQuery.isError || !serviceQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load service</AlertTitle>
        <AlertDescription>
          Check that the service exists and the platform secret can call
          API Center registry endpoints.
        </AlertDescription>
      </Alert>
    );
  }

  const service = serviceQuery.data;
  const isTribe = (service.serviceType ?? "tribe") === "tribe";
  const activeSection = section;

  return (
    <ServiceDetailShell
      activeSection={activeSection}
      onSelectSection={selectSection}
    >
      <ServiceDetailContent
        activeSection={activeSection}
        service={service}
        services={servicesQuery.data ?? []}
        isTribe={isTribe}
        credentialServiceId={credentialServiceId}
        consumers={consumers}
        brokenDependencies={brokenDependencies}
        lifecycleEntry={lifecycleEntry}
        healthResult={healthResult}
        healthPending={healthMutation.isPending}
        onCheckHealth={() => healthMutation.mutate()}
        quotaPolicies={quotaPoliciesQuery.data ?? []}
        quotaUsage={quotaUsageQuery.data ?? []}
        quotaLoading={
          quotaPoliciesQuery.isLoading ||
          quotaPoliciesQuery.isFetching ||
          quotaUsageQuery.isLoading ||
          quotaUsageQuery.isFetching
        }
        pipeline={{
          environment: pipelineHealthEnvironment,
          partitionValue: pipelinePartitionValue,
          healthRows: pipelineHealthQuery.data ?? [],
          healthLoading:
            pipelineHealthQuery.isLoading || pipelineHealthQuery.isFetching,
          qualityRows: pipelineQualityQuery.data ?? [],
          sharedServiceUsageRows: pipelineSharedServiceUsageQuery.data ?? [],
          gatewayDecisionRows: pipelineGatewayDecisionQuery.data ?? [],
          decisionSignalRows: pipelineDecisionSignalQuery.data ?? [],
          costRows: pipelineCostQuery.data ?? [],
          governanceLoading:
            pipelineQualityQuery.isLoading ||
            pipelineQualityQuery.isFetching ||
            pipelineSharedServiceUsageQuery.isLoading ||
            pipelineSharedServiceUsageQuery.isFetching ||
            pipelineGatewayDecisionQuery.isLoading ||
            pipelineGatewayDecisionQuery.isFetching ||
            pipelineDecisionSignalQuery.isLoading ||
            pipelineDecisionSignalQuery.isFetching ||
            pipelineCostQuery.isLoading ||
            pipelineCostQuery.isFetching,
          onEnvironmentChange: setPipelineHealthEnvironment,
          onPartitionValueChange: setPipelinePartitionValue,
        }}
        secret={{
          plaintextSecret,
          secretHash,
          provisionedSecret,
          manualCopy,
          pending: provisionSecretMutation.isPending,
          operationPreview: secretPreview,
          previewPending: previewSecretMutation.isPending,
          typedPhrase: secretTypedPhrase,
          operatorReason: secretOperatorReason,
          environment: secretEnvironment,
          onGenerate: generateTribeSecret,
          onCopy: copyPlaintextSecret,
          onProvision: () => provisionSecretMutation.mutate(),
          onPreview: () => previewSecretMutation.mutate(),
          onEnvironmentChange: setSecretEnvironment,
          onTypedPhraseChange: setSecretTypedPhrase,
          onOperatorReasonChange: setSecretOperatorReason,
        }}
        lifecycleActions={{
          activatePending: activateMutation.isPending,
          deprecatePending: deprecateMutation.isPending,
          retirePending: retireMutation.isPending,
          deregisterPending: deregisterMutation.isPending,
          onActivate: () => activateMutation.mutate(),
          onDeprecate: () => deprecateMutation.mutate(),
          onRetire: () => retireMutation.mutate(),
          onDeregister: () => deregisterMutation.mutate(),
          onDeregistered: () => router.push("/tribes"),
        }}
      />
    </ServiceDetailShell>
  );
}
