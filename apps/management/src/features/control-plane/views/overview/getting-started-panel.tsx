"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, ChevronDownIcon, CircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/patterns/copy-button";
import { ErrorPanel } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { projectHref } from "@/lib/app-navigation";
import { cn } from "@/lib/utils";
import { controlPlane } from "../../data/control-plane-repository";
import { gettingStartedSteps, sdkSnippet, type GettingStartedStep } from "../../model/getting-started";
import { useEnvironmentCredentials, useEnvironmentGrants } from "../../view-models/environment-inventory";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";

/** From an empty environment to a first request: five steps, each linking to where it is done, then the SDK snippet. */
export function GettingStartedPanel() {
  const { organizationId, project, kind, environment } = useProjectEnvironment();
  const target = { organizationId, projectId: project.id, kind };
  const applications = useQuery({
    queryKey: cpKeys.applications(organizationId, project.id, kind),
    queryFn: () => controlPlane.applications(organizationId, project.id, kind),
  });
  const usage = useQuery({
    queryKey: cpKeys.usage(organizationId, project.id, kind),
    queryFn: () => controlPlane.usage(organizationId, project.id, kind),
  });
  const grants = useEnvironmentGrants(target);
  const credentials = useEnvironmentCredentials(target);
  const [expanded, setExpanded] = useState(false);

  const error = applications.error ?? grants.error ?? credentials.error ?? usage.error;
  if (error) {
    return (
      <Panel title="Getting started">
        <ErrorPanel title="Setup progress is unavailable" error={error} />
      </Panel>
    );
  }
  if (!applications.data || !grants.data || !credentials.data || !usage.data) {
    return (
      <Panel title="Getting started">
        <Skeleton className="h-28 w-full" />
      </Panel>
    );
  }

  const steps = gettingStartedSteps(
    {
      enabledCapabilities: environment?.capabilities.filter((entry) => entry.status === "enabled").length ?? 0,
      applications: applications.data,
      grants: grants.data,
      credentials: credentials.data,
      requests: usage.data.requests,
    },
    (applicationId, tab) => `/applications/${encodeURIComponent(applicationId)}?tab=${tab}`,
  );
  const doneCount = steps.filter((step) => step.done).length;
  const complete = doneCount === steps.length;
  const open = !complete || expanded;
  const snippet = sdkSnippet(
    kind,
    grants.data.map((grant) => grant.action),
  );

  return (
    <Panel
      title="Getting started"
      description={complete ? "Every step is done: this environment has served a request." : `${doneCount} of ${steps.length} steps done.`}
      flush
      actions={
        complete ? (
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setExpanded((value) => !value)}>
            {open ? "Hide" : "Show steps"}
            <ChevronDownIcon data-icon="inline-end" className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        ) : (
          <Progress done={doneCount} total={steps.length} />
        )
      }
    >
      {open ? (
        <div className="grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:divide-x">
          <ol className="flex flex-col gap-1 p-3">
            {steps.map((step, index) => (
              <StepItem key={step.id} step={step} number={index + 1} href={projectHref(project.id, kind, step.path)} />
            ))}
          </ol>
          <div className="flex min-w-0 flex-col gap-3 border-t p-4 lg:border-t-0">
            <p className="text-[13px] text-muted-foreground">
              Call APICenter from your backend with the server-side SDK.{" "}
              {snippet.action ? (
                <>
                  This calls <code className="font-mono text-xs text-foreground">{snippet.action}</code>, which an application here is granted.
                </>
              ) : (
                <>Grant an action to see a call for it; until then this checks the key.</>
              )}
            </p>
            <CodeBlock label=".npmrc" value={snippet.npmrc} />
            <CodeBlock label="Install" value={snippet.install} />
            <CodeBlock label="Environment" value={snippet.env} />
            <CodeBlock label="First request" value={snippet.code} />
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label={`${done} of ${total} steps done`}>
      <div className="flex gap-0.5" aria-hidden>
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className={cn("h-1.5 w-5 rounded-full", index < done ? "bg-success" : "bg-muted")} />
        ))}
      </div>
      <span className="tabular-nums">
        {done}/{total}
      </span>
    </div>
  );
}

function StepItem({ step, number, href }: { step: GettingStartedStep; number: number; href: string }) {
  return (
    <li>
      <Link href={href} className="flex gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60">
        {step.done ? (
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" />
        ) : (
          <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" aria-label="Not done" />
        )}
        <span className="min-w-0 text-[13px]">
          <span className={cn("font-medium", step.done && "text-muted-foreground")}>
            {number}. {step.label}
          </span>
          {step.done ? null : <span className="mt-0.5 block text-muted-foreground">{step.hint}</span>}
        </span>
      </Link>
    </li>
  );
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex h-8 items-center justify-between border-b bg-muted/50 pr-1 pl-3 text-xs text-muted-foreground">
        <span>{label}</span>
        <CopyButton value={value} label={`Copy ${label}`} />
      </div>
      <pre className="overflow-x-auto bg-card px-3 py-2 font-mono text-xs leading-5">
        <code>{value}</code>
      </pre>
    </div>
  );
}
