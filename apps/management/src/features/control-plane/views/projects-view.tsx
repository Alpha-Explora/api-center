"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/page-heading";
import { controlPlane } from "../data/control-plane-repository";
import { useOrganization } from "../view-models/use-organization";
import { OrganizationPicker } from "./organization-picker";

const SLUG = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export function ProjectsView() {
  const { organizationId, setOrganizationId, organizations } = useOrganization();
  const client = useQueryClient();
  const projects = useQuery({
    queryKey: ["cp-projects", organizationId],
    queryFn: () => controlPlane.listProjects(organizationId as string),
    enabled: Boolean(organizationId),
    retry: false,
  });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const create = useMutation({
    mutationFn: () => controlPlane.createProject(organizationId as string, { name: name.trim(), slug }),
    onSuccess: (project) => {
      toast.success(`Created ${project.name} with a test environment`);
      setName("");
      setSlug("");
      void client.invalidateQueries({ queryKey: ["cp-projects", organizationId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Projects"
        description="A project is one product. Each environment has its own applications, grants and credentials; publishing an API is optional."
        actions={<OrganizationPicker organizationId={organizationId} organizations={organizations} onChange={setOrganizationId} />}
      />
      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
          <CardDescription>Creates the project and its test environment. You become its administrator.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Input
              aria-label="Project name"
              placeholder="Name, e.g. Serbizio"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slug || slug === toSlug(name)) setSlug(toSlug(event.target.value));
              }}
            />
            <Input aria-label="Project slug" className="font-mono" placeholder="slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
            <Button disabled={!organizationId || !name.trim() || !SLUG.test(slug) || create.isPending} type="submit">
              Create project
            </Button>
          </form>
        </CardContent>
      </Card>
      {projects.error ? (
        <Alert variant="destructive">
          <AlertDescription>{(projects.error as Error).message}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(projects.data ?? []).map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <Link className="font-medium underline-offset-4 hover:underline" href={`/control-plane/projects/${project.id}`}>
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{project.slug}</TableCell>
                  <TableCell>
                    <Badge variant={project.status === "active" ? "secondary" : "outline"}>{project.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {projects.data?.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={3}>
                    No projects you can see yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
