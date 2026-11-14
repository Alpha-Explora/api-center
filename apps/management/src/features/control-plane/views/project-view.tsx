"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeading } from "@/components/page-heading";
import { controlPlane } from "../data/control-plane-repository";
import type { Application, Capability, EnvironmentKind, IssuedCredential, Project } from "../model/control-plane";
import { useOrganization } from "../view-models/use-organization";
import { toSlug } from "./projects-view";

export function ProjectView({ projectId }: { projectId: string }) {
  const { organizationId } = useOrganization();
  const project = useQuery({
    queryKey: ["cp-project", organizationId, projectId],
    queryFn: () => controlPlane.project(organizationId as string, projectId),
    enabled: Boolean(organizationId),
    retry: false,
  });
  const capabilities = useQuery({ queryKey: ["cp-capabilities"], queryFn: controlPlane.capabilities });

  if (project.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{(project.error as Error).message}</AlertDescription>
      </Alert>
    );
  }
  if (!project.data || !organizationId) return <p className="text-sm text-muted-foreground">Loading project…</p>;
  const hasLive = project.data.environments.some((environment) => environment.kind === "live");

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title={project.data.name}
        description={`${project.data.slug} · test and live are separate: applications, grants and credentials are never copied between them.`}
      />
      <Tabs defaultValue="test">
        <TabsList>
          <TabsTrigger value="test">Test</TabsTrigger>
          <TabsTrigger value="live">Live</TabsTrigger>
        </TabsList>
        <TabsContent value="test" className="mt-4">
          <EnvironmentPanel organizationId={organizationId} project={project.data} kind="test" capabilities={capabilities.data ?? []} />
        </TabsContent>
        <TabsContent value="live" className="mt-4 flex flex-col gap-4">
          <LiveSetup organizationId={organizationId} projectId={projectId} hasLive={hasLive} />
          {hasLive ? <EnvironmentPanel organizationId={organizationId} project={project.data} kind="live" capabilities={capabilities.data ?? []} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EnvironmentPanel({
  organizationId,
  project,
  kind,
  capabilities,
}: {
  organizationId: string;
  project: Project;
  kind: EnvironmentKind;
  capabilities: Capability[];
}) {
  const client = useQueryClient();
  const environment = project.environments.find((entry) => entry.kind === kind);
  const enabled = new Set(environment?.capabilities.filter((entry) => entry.status === "enabled").map((entry) => entry.capability));
  const refresh = () => client.invalidateQueries({ queryKey: ["cp-project", organizationId, project.id] });
  const toggle = useMutation({
    mutationFn: (input: { capability: string; on: boolean }) => controlPlane.setCapability(organizationId, project.id, kind, input.capability, input.on),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const plans = useQuery({ queryKey: ["cp-plans"], queryFn: controlPlane.plans });
  const plan = useQuery({ queryKey: ["cp-plan", project.id, kind], queryFn: () => controlPlane.plan(organizationId, project.id, kind), retry: false });
  const usage = useQuery({ queryKey: ["cp-usage", project.id, kind], queryFn: () => controlPlane.usage(organizationId, project.id, kind), retry: false });
  const assignPlan = useMutation({
    mutationFn: (planKey: string) => controlPlane.assignPlan(organizationId, project.id, kind, planKey),
    onSuccess: () => client.invalidateQueries({ queryKey: ["cp-plan", project.id, kind] }),
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
          <CardDescription>Enabling a capability grants no application access; grant actions per application below.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {capabilities.map((capability) => {
            const on = enabled.has(capability.id);
            return (
              <Button
                key={capability.id}
                size="sm"
                variant={on ? "default" : "outline"}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ capability: capability.id, on: !on })}
              >
                {capability.name} {on ? "· on" : "· off"}
              </Button>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Plan and usage</CardTitle>
          <CardDescription>
            {kind === "test" ? "Without a plan, test requests have a bounded daily default." : "Live requests need a live-capable plan."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Plan</span>
            <select
              className="h-9 rounded-md border bg-background px-2"
              value={plan.data?.planKey ?? ""}
              onChange={(event) => event.target.value && assignPlan.mutate(event.target.value)}
            >
              <option value="">{kind === "test" ? "Test default" : "None"}</option>
              {(plans.data ?? [])
                .filter((entry) => kind === "test" || entry.liveAllowed)
                .map((entry) => (
                  <option key={entry.planKey} value={entry.planKey}>
                    {entry.displayName} ({entry.requestsPerDay ?? "unlimited"} requests/day)
                  </option>
                ))}
            </select>
          </label>
          <p className="text-muted-foreground">{usage.data ? `${usage.data.requests} request(s) in the last 24 hours.` : "Usage unavailable."}</p>
        </CardContent>
      </Card>
      <ApplicationsPanel organizationId={organizationId} projectId={project.id} kind={kind} capabilities={capabilities} enabled={enabled} />
    </div>
  );
}

function ApplicationsPanel({
  organizationId,
  projectId,
  kind,
  capabilities,
  enabled,
}: {
  organizationId: string;
  projectId: string;
  kind: EnvironmentKind;
  capabilities: Capability[];
  enabled: Set<string | undefined>;
}) {
  const client = useQueryClient();
  const queryKey = ["cp-applications", projectId, kind];
  const applications = useQuery({ queryKey, queryFn: () => controlPlane.applications(organizationId, projectId, kind), retry: false });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => controlPlane.createApplication(organizationId, projectId, kind, { name: name.trim(), slug: toSlug(name) }),
    onSuccess: () => {
      setName("");
      void client.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Applications</CardTitle>
        <CardDescription>Each backend, worker or integration gets its own identity, explicit grants and {kind} credentials.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Input aria-label="Application name" placeholder="Name, e.g. API server" value={name} onChange={(event) => setName(event.target.value)} />
          <Button disabled={!name.trim() || create.isPending} type="submit">
            Add application
          </Button>
        </form>
        {(applications.data ?? []).map((application) => (
          <ApplicationCard
            key={application.id}
            organizationId={organizationId}
            projectId={projectId}
            kind={kind}
            application={application}
            capabilities={capabilities.filter((capability) => enabled.has(capability.id))}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ApplicationCard({
  organizationId,
  projectId,
  kind,
  application,
  capabilities,
}: {
  organizationId: string;
  projectId: string;
  kind: EnvironmentKind;
  application: Application;
  capabilities: Capability[];
}) {
  const client = useQueryClient();
  const grantsKey = ["cp-grants", application.id];
  const credentialsKey = ["cp-credentials", application.id];
  const grants = useQuery({ queryKey: grantsKey, queryFn: () => controlPlane.grants(organizationId, projectId, kind, application.id) });
  const credentials = useQuery({ queryKey: credentialsKey, queryFn: () => controlPlane.credentials(organizationId, projectId, kind, application.id) });
  const [action, setAction] = useState("");
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());

  const grant = useMutation({
    mutationFn: () => controlPlane.grant(organizationId, projectId, kind, application.id, { capability: action.split(":")[0], action }),
    onSuccess: () => client.invalidateQueries({ queryKey: grantsKey }),
    onError: (error: Error) => toast.error(error.message),
  });
  const revokeGrant = useMutation({
    mutationFn: (grantId: string) => controlPlane.revokeGrant(organizationId, projectId, kind, application.id, grantId),
    onSuccess: () => client.invalidateQueries({ queryKey: grantsKey }),
    onError: (error: Error) => toast.error(error.message),
  });
  const issue = useMutation({
    mutationFn: () => controlPlane.issueCredential(organizationId, projectId, kind, application.id, operationId),
    onSuccess: (credential) => {
      setIssued(credential);
      setOperationId(crypto.randomUUID());
      void client.invalidateQueries({ queryKey: credentialsKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: (credentialId: string) => controlPlane.revokeCredential(organizationId, projectId, kind, application.id, credentialId, "Revoked in the console"),
    onSuccess: () => client.invalidateQueries({ queryKey: credentialsKey }),
    onError: (error: Error) => toast.error(error.message),
  });
  const granted = new Set((grants.data ?? []).filter((entry) => entry.status === "active").map((entry) => entry.action));
  const options = capabilities.flatMap((capability) => capability.actions.map((entry) => entry.action)).filter((entry) => !granted.has(entry));

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">{application.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{application.id}</p>
        </div>
        <Button size="sm" disabled={issue.isPending} onClick={() => issue.mutate()}>
          Issue {kind} key
        </Button>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium">Grants</p>
          <div className="flex flex-wrap gap-1">
            {(grants.data ?? [])
              .filter((entry) => entry.status === "active")
              .map((entry) => (
                <Badge key={entry.id} variant="secondary" className="gap-1">
                  {entry.action}
                  <button aria-label={`Revoke ${entry.action}`} className="ml-1 text-muted-foreground" onClick={() => revokeGrant.mutate(entry.id)}>
                    ×
                  </button>
                </Badge>
              ))}
          </div>
          <div className="mt-2 flex gap-2">
            <select aria-label="Action to grant" className="h-9 flex-1 rounded-md border bg-background px-2 text-sm" value={action} onChange={(event) => setAction(event.target.value)}>
              <option value="">Choose an action…</option>
              {options.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" disabled={!action || grant.isPending} onClick={() => grant.mutate()}>
              Grant
            </Button>
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Credentials</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prefix</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(credentials.data ?? []).map((credential) => (
                <TableRow key={credential.id}>
                  <TableCell className="font-mono text-xs">{credential.lookupPrefix}…</TableCell>
                  <TableCell>{credential.status}</TableCell>
                  <TableCell className="text-right">
                    {credential.status === "active" ? (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(credential.id)}>
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <SecretOnce credential={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

/** Shows a newly issued key exactly once. Only a verifier is stored; it cannot be shown again. */
export function SecretOnce({ credential, onClose }: { credential: IssuedCredential | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(credential)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy this key now</DialogTitle>
          <DialogDescription>It will not be shown again. Store it as a secret in the application&apos;s deployment.</DialogDescription>
        </DialogHeader>
        <code className="block break-all rounded-md bg-muted p-3 text-xs">{credential?.secret}</code>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(credential?.secret ?? "").then(
                () => toast.success("Key copied"),
                () => toast.error("Copy was blocked; select the key and copy it manually"),
              );
            }}
          >
            Copy
          </Button>
          <Button onClick={onClose}>I stored it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LiveSetup({ organizationId, projectId, hasLive }: { organizationId: string; projectId: string; hasLive: boolean }) {
  const client = useQueryClient();
  const readiness = useQuery({
    queryKey: ["cp-live-readiness", projectId],
    queryFn: () => controlPlane.liveReadiness(organizationId, projectId),
    enabled: hasLive,
    retry: false,
  });
  const [approvalId, setApprovalId] = useState("");
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["cp-project", organizationId, projectId] });
    void client.invalidateQueries({ queryKey: ["cp-live-readiness", projectId] });
  };
  const provision = useMutation({ mutationFn: () => controlPlane.provisionLive(organizationId, projectId), onSuccess: refresh, onError: (error: Error) => toast.error(error.message) });
  const activate = useMutation({
    mutationFn: () => controlPlane.activateLive(organizationId, projectId, approvalId.trim()),
    onSuccess: () => {
      toast.success("Live environment activated");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!hasLive) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Go live</CardTitle>
          <CardDescription>Provision a separate live environment. Nothing is copied from test.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button disabled={provision.isPending} onClick={() => provision.mutate()}>
            Provision live environment
          </Button>
        </CardContent>
      </Card>
    );
  }
  const data = readiness.data;
  if (!data || data.status !== "provisioning") return null;
  return (
    <Alert>
      <AlertTitle>Live is provisioning</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <ul className="text-sm">
          {data.checks.map((check) => (
            <li key={check.key}>
              {check.passed ? "✓" : "✗"} {check.detail}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Activation consumes one approved <code>environment.activate_live</code> request for this project.
        </p>
        <div className="flex gap-2">
          <Input aria-label="Approval request ID" placeholder="Approval request ID" value={approvalId} onChange={(event) => setApprovalId(event.target.value)} />
          <Button disabled={!data.ready || !approvalId.trim() || activate.isPending} onClick={() => activate.mutate()}>
            Activate live
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
