"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EyeIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getApiCenterBaseUrl,
  requestQuotaIncrease,
} from "@/lib/api-center-client";
import { withTimeout } from "@/lib/promise-timeout";
import type { QuotaPolicy, ServiceRegistryEntry } from "@/lib/schemas";
import {
  type DeveloperPortalAction,
  serviceDetailHref,
} from "@/components/developer-portal-preview/developer-portal-actions";
import {
  buildPortalPreview,
  formatQuota,
} from "@/components/developer-portal-preview/portal-preview-model";
import { DeveloperPortalRequestPanel } from "@/components/developer-portal-request-panel";
import { ActionFailedState, EmptyDataState } from "@/components/query-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type DeveloperPortalData = {
  tribeId: string;
  services: ServiceRegistryEntry[];
  quotaPolicies: QuotaPolicy[];
};

export function DeveloperPortalPreview({
  initialTribeId = "",
}: {
  initialTribeId?: string;
}) {
  const router = useRouter();
  const [formTribeId, setFormTribeId] = useState(initialTribeId);
  const [previewTribeId, setPreviewTribeId] = useState(initialTribeId);
  const enabled = Boolean(previewTribeId.trim());
  const portalQuery = useQuery({
    queryKey: ["developer-portal-preview", "tribe", previewTribeId],
    queryFn: async () =>
      withTimeout(
        fetch(
          `/api/local/developer-portal/${encodeURIComponent(previewTribeId)}`,
          { cache: "no-store" },
        ).then(async (response) => {
          if (!response.ok) {
            throw new Error("Developer portal data request failed.");
          }

          const payload = (await response.json()) as {
            success: boolean;
            data: DeveloperPortalData;
          };

          if (!payload.success) {
            throw new Error("Developer portal data request failed.");
          }

          return payload.data;
        }),
        3000,
        "Developer portal data request timed out.",
      ),
    enabled,
    retry: false,
  });
  const quotaRequestMutation = useMutation({
    mutationFn: requestQuotaIncrease,
  });
  const portalData = useMemo(
    () =>
      buildPortalPreview({
        tribeId: previewTribeId,
        services: portalQuery.data?.services ?? [],
        quotaPolicies: portalQuery.data?.quotaPolicies ?? [],
      }),
    [previewTribeId, portalQuery.data],
  );

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTribeId = formTribeId.trim();
    setPreviewTribeId(nextTribeId);
    quotaRequestMutation.reset();
    if (nextTribeId) {
      router.replace(
        `/developer-portal?tribeId=${encodeURIComponent(nextTribeId)}`,
        { scroll: false },
      );
    } else {
      router.replace("/developer-portal", { scroll: false });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Preview tribe portal</CardTitle>
            <CardDescription>
              Review the read-only portal data a tribe can use for onboarding,
              SDK setup, quotas, and event publishing.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              portalQuery.refetch();
            }}
            disabled={
              !enabled || portalQuery.isFetching
            }
          >
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
            <Field className="max-w-md">
              <FieldLabel htmlFor="developer-portal-tribe-id">
                Tribe ID
              </FieldLabel>
              <Input
                id="developer-portal-tribe-id"
                value={formTribeId}
                onChange={(event) => setFormTribeId(event.target.value)}
                required
              />
            </Field>
            <Button type="submit" className="self-end">
              <EyeIcon data-icon="inline-start" />
              Preview portal
            </Button>
          </form>
        </CardContent>
      </Card>

      {!enabled ? (
        <EmptyDataState
          title="Choose a tribe"
          description="Enter a tribe ID to preview the self-service portal packet. The packet depends on registry ownership and quota policy source data."
          recoverySteps={[
            {
              label: "Find the owner tribe ID",
              description:
                "Use the registry owner field or a service detail page to confirm the tribe identifier.",
            },
            {
              label: "Verify registry source data",
              description:
                "Confirm the tribe has at least one registered service before expecting lifecycle or allowed-service rows.",
            },
            {
              label: "Preview the portal packet",
              description:
                "Submit the tribe ID, then check quota policy, SDK runbook, and setup actions.",
            },
          ]}
        />
      ) : portalQuery.isLoading ? (
        <Skeleton className="h-[28rem] rounded-xl" />
      ) : portalQuery.isError ? (
        <ActionFailedState
          title="Could not load portal preview"
          description="Check API Center admin credentials and registry availability."
          recoverySteps={[
            {
              label: "Check tribe ID",
              description:
                "Confirm the tribe ID matches a registered owner or consumer.",
            },
            {
              label: "Check registry and quota access",
              description:
                "The preview needs both service registry and quota policy reads.",
            },
          ]}
        />
      ) : (
        <PortalPreviewContent
          data={portalData}
          quotaRequestError={quotaRequestMutation.isError}
          quotaRequestPending={quotaRequestMutation.isPending}
          quotaRequestSubmitted={quotaRequestMutation.isSuccess}
          onQuotaRequest={(input) => quotaRequestMutation.mutate(input)}
        />
      )}
    </div>
  );
}

function PortalPreviewContent({
  data,
  onQuotaRequest,
  quotaRequestError,
  quotaRequestPending,
  quotaRequestSubmitted,
}: {
  data: ReturnType<typeof buildPortalPreview>;
  onQuotaRequest: Parameters<typeof DeveloperPortalRequestPanel>[0]["onSubmit"];
  quotaRequestError: boolean;
  quotaRequestPending: boolean;
  quotaRequestSubmitted: boolean;
}) {
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const selectedAction =
    data.actions.find((action) => action.id === selectedActionId) ??
    data.actions[0];

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
      <div className="xl:col-span-2">
        <DeveloperPortalActionReview
          actions={data.actions}
          selectedAction={selectedAction}
          onSelectAction={setSelectedActionId}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <InfoCard title="Profile">
          <dl className="grid gap-2 text-sm">
            <Detail label="Tribe" value={data.tribeId} mono />
            <Detail label="SDK" value="@alpha-explora/apicenter-sdk" />
            <Detail label="API Center" value={getApiCenterBaseUrl()} />
            <Detail label="Support" value={data.supportContact} />
          </dl>
        </InfoCard>

        <InfoCard title="Allowed services">
          <TokenList
            items={data.allowedServices.map((service) => service.serviceId)}
          />
          <TokenList items={data.allowedScopes} muted />
        </InfoCard>

        <InfoCard title="Quota policy">
          {data.quotaPolicies.length ? (
            <div className="flex flex-col gap-2">
              {data.quotaPolicies.map((policy) => (
                <div
                  key={policy.id}
                  className="rounded-lg border bg-muted/25 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>{formatQuota(policy)}</span>
                    <Badge variant="secondary">{policy.mode}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {policy.scope}
                    {policy.targetServiceId
                      ? ` / ${policy.targetServiceId}`
                      : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active quota policy is visible for this tribe.
            </p>
          )}
        </InfoCard>

        <InfoCard title="Event topics">
          <TokenList items={data.recommendedTopics} mono />
        </InfoCard>
      </div>

      <div className="grid gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Onboarding packet</CardTitle>
            <CardDescription>
              Sendable details for setup without runtime credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {data.checklist.map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between gap-3"
              >
                <span>{item.label}</span>
                <Badge variant={item.complete ? "secondary" : "outline"}>
                  {item.complete ? "ready" : "pending"}
                </Badge>
              </div>
            ))}
            <Link
              href="/docs/consumer-runbook"
              className="mt-2 inline-flex h-8 items-center justify-center rounded-full border px-3 font-medium hover:bg-muted"
            >
              Open SDK runbook
            </Link>
          </CardContent>
        </Card>
        <InfoCard title="Lifecycle state">
          {data.lifecycleEntries.length ? (
            <div className="flex flex-col gap-3">
              {data.lifecycleEntries.map((entry) => (
                <div
                  key={entry.service.serviceId}
                  className="rounded-lg border bg-muted/20 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">
                      {entry.service.name || entry.service.serviceId}
                    </span>
                    <Badge
                      variant={
                        entry.status === "blocked"
                          ? "destructive"
                          : entry.status === "ready"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {entry.status}
                    </Badge>
                  </div>
                  <Link
                    href={entry.nextAction.href}
                    className="mt-2 inline-flex text-xs font-medium underline-offset-4 hover:underline"
                  >
                    {entry.nextAction.label}
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No registered service is visible for this tribe.
            </p>
          )}
        </InfoCard>
        <div id="developer-portal-quota-request">
          <DeveloperPortalRequestPanel
            disabled={!data.tribeId}
            ownerTribeId={data.tribeId}
            pending={quotaRequestPending}
            onSubmit={onQuotaRequest}
          />
        </div>
        {quotaRequestSubmitted ? (
          <Alert>
            <AlertTitle>Quota request submitted</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>The request is now waiting for approval review.</span>
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <Link
                  href={serviceDetailHref(data.tribeId, "quotas")}
                  className="font-medium text-foreground"
                >
                  Review quota detail
                </Link>
                <Link
                  href={serviceDetailHref(data.tribeId, "evidence")}
                  className="font-medium text-foreground"
                >
                  Open evidence trail
                </Link>
              </span>
            </AlertDescription>
          </Alert>
        ) : null}
        {quotaRequestError ? (
          <ActionFailedState
            title="Quota request failed"
            description="Check management auth and approval service availability."
            recoverySteps={[
              {
                label: "Keep the portal packet visible",
                description:
                  "The preview remains available while the request endpoint is repaired.",
              },
              {
                label: "Retry the quota request",
                description:
                  "Submit again after approval routing is healthy.",
              },
            ]}
          />
        ) : null}
      </div>
    </div>
  );
}

function DeveloperPortalActionReview({
  actions,
  selectedAction,
  onSelectAction,
}: {
  actions: DeveloperPortalAction[];
  selectedAction?: DeveloperPortalAction;
  onSelectAction: (actionId: string) => void;
}) {
  if (!actions.length) {
    return (
      <section className="rounded-lg border bg-muted/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheckIcon data-icon="inline-start" />
          Developer actions
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No setup actions are available for this portal packet.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
      <div className="overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Action</span>
          <span>Severity</span>
          <span>Evidence</span>
          <span className="sr-only">Inspect</span>
        </div>
        <div className="divide-y">
          {actions.map((action) => (
            <DeveloperPortalActionRow
              key={action.id}
              action={action}
              selected={action.id === selectedAction?.id}
              onSelect={() => onSelectAction(action.id)}
            />
          ))}
        </div>
      </div>
      {selectedAction ? (
        <DeveloperPortalActionDetail action={selectedAction} />
      ) : null}
    </section>
  );
}

function DeveloperPortalActionRow({
  action,
  selected,
  onSelect,
}: {
  action: DeveloperPortalAction;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] md:items-start">
      <div className="min-w-0">
        <div className="truncate font-medium">{action.label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {action.source}
        </div>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant={action.severity === "info" ? "secondary" : "destructive"}>
          {action.severity}
        </Badge>
      </div>
      <div className="col-start-1 min-w-0 break-words text-sm text-muted-foreground md:col-auto">
        {action.evidence}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect developer portal action ${action.label}`}
        title={`Inspect developer portal action ${action.label}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function DeveloperPortalActionDetail({
  action,
}: {
  action: DeveloperPortalAction;
}) {
  return (
    <aside
      aria-label="Selected developer portal action"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Recommended next step</div>
          <div className="mt-1 truncate text-base font-medium">
            {action.label}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {action.source}
          </div>
        </div>
        <Badge variant={action.severity === "info" ? "secondary" : "destructive"}>
          {action.severity}
        </Badge>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">Evidence</div>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {action.evidence}
        </p>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Next action
        </div>
        <Link
          href={action.action.href}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          {action.action.label}
          <ShieldCheckIcon data-icon="inline-end" />
        </Link>
      </div>
    </aside>
  );
}

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "text-right font-medium"}>
        {value}
      </dd>
    </div>
  );
}

function TokenList({
  items,
  mono = false,
  muted = false,
}: {
  items: string[];
  mono?: boolean;
  muted?: boolean;
}) {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">None configured</p>;
  }

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge
          key={item}
          variant={muted ? "outline" : "secondary"}
          className={mono ? "font-mono" : ""}
        >
          {item}
        </Badge>
      ))}
    </div>
  );
}
