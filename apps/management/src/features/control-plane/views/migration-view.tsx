"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/page-heading";
import { controlPlane } from "../data/control-plane-repository";
import type { EnvironmentKind } from "../model/control-plane";
import { useOrganization } from "../view-models/use-organization";
import { OrganizationPicker } from "./organization-picker";

export function MigrationView() {
  const { organizationId, setOrganizationId, organizations, platformAdmin } = useOrganization();
  const client = useQueryClient();
  const enabled = Boolean(organizationId) && platformAdmin;
  const inventory = useQuery({ queryKey: ["cp-inventory", organizationId], queryFn: () => controlPlane.inventory(organizationId as string), enabled, retry: false });
  const assignments = useQuery({ queryKey: ["cp-assignments", organizationId], queryFn: () => controlPlane.assignments(organizationId as string), enabled, retry: false });
  const mismatches = useQuery({ queryKey: ["cp-mismatches", organizationId], queryFn: () => controlPlane.mismatches(organizationId as string), enabled, retry: false });
  const refresh = () => {
    for (const key of ["cp-inventory", "cp-assignments", "cp-mismatches"]) void client.invalidateQueries({ queryKey: [key, organizationId] });
  };
  const onError = (error: Error) => toast.error(error.message);
  const backfill = useMutation({
    mutationFn: () => controlPlane.backfill(organizationId as string, inventory.data?.revision ?? ""),
    onSuccess: () => {
      toast.success("Backfill applied; migrated environments stay legacy-governed until cutover");
      refresh();
    },
    onError,
  });
  const cutover = useMutation({
    mutationFn: (input: { projectId: string; kind: EnvironmentKind; fence: number }) => controlPlane.cutover(organizationId as string, input.projectId, input.kind, input.fence),
    onSuccess: refresh,
    onError,
  });
  const rollback = useMutation({
    mutationFn: (input: { projectId: string; kind: EnvironmentKind; fence: number }) => controlPlane.rollback(organizationId as string, input.projectId, input.kind, input.fence),
    onSuccess: refresh,
    onError,
  });

  if (!platformAdmin) {
    return (
      <Alert>
        <AlertTitle>Platform operators only</AlertTitle>
        <AlertDescription>Migrating an organization from tribes to the control plane is a platform operator action.</AlertDescription>
      </Alert>
    );
  }
  const plan = inventory.data?.plan;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Migration"
        description="Inventory → backfill → shadow → cutover, one project environment at a time, test before live. Legacy credentials keep working throughout."
        actions={<OrganizationPicker organizationId={organizationId} organizations={organizations} onChange={setOrganizationId} />}
      />
      <Card>
        <CardHeader>
          <CardTitle>Inventory</CardTitle>
          <CardDescription>
            Revision <code className="text-xs">{inventory.data?.revision.slice(0, 16) ?? "…"}</code> — backfill applies exactly this revision and refuses if the legacy source changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {inventory.error ? <p className="text-destructive">{(inventory.error as Error).message}</p> : null}
          {plan ? (
            <>
              <p>
                {plan.projects.length} project(s), {plan.projects.reduce((sum, project) => sum + project.environments.reduce((n, environment) => n + environment.applications.length, 0), 0)} application(s).
              </p>
              {plan.blockers.length ? (
                <Alert variant="destructive">
                  <AlertTitle>{plan.blockers.length} blocker(s)</AlertTitle>
                  <AlertDescription>
                    <ul>
                      {plan.blockers.map((blocker) => (
                        <li key={`${blocker.legacyId}-${blocker.reason}`}>
                          <code>{blocker.legacyId}</code>: {blocker.reason}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
              {plan.approximations.length ? (
                <details>
                  <summary>{plan.approximations.length} approximation(s) to review</summary>
                  <ul className="mt-2 list-disc pl-5">
                    {plan.approximations.map((entry) => (
                      <li key={`${entry.legacyId}-${entry.note}`}>
                        <code>{entry.legacyId}</code>: {entry.note}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div>
                <Button disabled={!inventory.data?.ready || backfill.isPending} onClick={() => backfill.mutate()}>
                  Backfill this revision
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Environments</CardTitle>
          <CardDescription>Cutover needs no unresolved shadow mismatch. Rollback is refused once control-plane state exists since cutover.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Legacy project</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Governed by</TableHead>
                <TableHead>Fence</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(assignments.data ?? []).map((assignment) => {
                const input = { projectId: assignment.projectId, kind: assignment.environmentKind as EnvironmentKind, fence: assignment.fenceVersion };
                return (
                  <TableRow key={`${assignment.projectId}-${assignment.environmentKind}`}>
                    <TableCell className="font-mono text-xs">{assignment.legacyProjectId}</TableCell>
                    <TableCell>{assignment.environmentKind}</TableCell>
                    <TableCell>
                      <Badge variant={assignment.authority === "new" ? "secondary" : "outline"}>{assignment.authority === "new" ? "control plane" : "legacy"}</Badge>
                    </TableCell>
                    <TableCell>{assignment.fenceVersion}</TableCell>
                    <TableCell className="text-right">
                      {assignment.authority === "legacy" ? (
                        <Button size="sm" disabled={cutover.isPending} onClick={() => cutover.mutate(input)}>
                          Cut over
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled={rollback.isPending} onClick={() => rollback.mutate(input)}>
                          Roll back
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Shadow mismatches</CardTitle>
          <CardDescription>Legacy calls whose control-plane decision would differ. Correct the grants, then resolve them through the API.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Caller</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Legacy / new</TableHead>
                <TableHead>Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(mismatches.data ?? []).map((row) => (
                <TableRow key={`${row.projectId}-${row.environmentKind}-${row.sourceServiceId}-${row.target}-${row.action}-${row.legacyAllowed}`}>
                  <TableCell className="font-mono text-xs">{row.sourceServiceId}</TableCell>
                  <TableCell className="font-mono text-xs">{row.target}</TableCell>
                  <TableCell className="font-mono text-xs">{row.action}</TableCell>
                  <TableCell>
                    {row.legacyAllowed ? "allow" : "deny"} / {row.newAllowed ? "allow" : "deny"}
                  </TableCell>
                  <TableCell>{row.occurrences}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
