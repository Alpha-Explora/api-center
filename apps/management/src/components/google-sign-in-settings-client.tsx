"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listTribes } from "@/lib/api-center/tenancy-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Environment = "test" | "live";
type Settings = {
  projectId: string;
  environment: Environment;
  redirectUris: string[];
  displayName: string;
  hasOwnClient: boolean;
  clientId: string | null;
  secretLastChangedAt: string | null;
};

export function GoogleSignInSettingsClient() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [environment, setEnvironment] = useState<Environment>("test");
  const [redirectUris, setRedirectUris] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [useOwnClient, setUseOwnClient] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [feedback, setFeedback] = useState("");

  const tribesQuery = useQuery({ queryKey: ["tenancy", "tribes"], queryFn: listTribes });
  const projects = useMemo(
    () => (tribesQuery.data ?? []).flatMap((tribe) => tribe.projects.map((project) => ({ ...project, tribeName: tribe.name }))),
    [tribesQuery.data],
  );
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].projectId);
  }, [projectId, projects]);

  const settingsQuery = useQuery({
    queryKey: ["google-sign-in", projectId, environment],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<Settings> => {
      const response = await fetch(settingsPath(projectId, environment), { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load Google sign-in settings.");
      return response.json() as Promise<Settings>;
    },
  });

  useEffect(() => {
    const settings = settingsQuery.data;
    if (!settings) return;
    setRedirectUris(settings.redirectUris.join("\n"));
    setDisplayName(settings.displayName);
    setUseOwnClient(settings.hasOwnClient);
    setClientId(settings.clientId ?? "");
    setClientSecret("");
    setFeedback("");
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const uris = redirectUris.split(/\r?\n/).map((uri) => uri.trim()).filter(Boolean);
      const payload: Record<string, unknown> = {
        redirectUris: uris,
        displayName: displayName.trim(),
        clientId: useOwnClient ? clientId.trim() : null,
      };
      if (useOwnClient && clientSecret) payload.clientSecret = clientSecret;
      const response = await fetch(settingsPath(projectId, environment), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? body?.error ?? "Settings could not be saved.");
      return body as Settings;
    },
    onSuccess: async (settings) => {
      setClientSecret("");
      setFeedback("Google sign-in settings saved.");
      queryClient.setQueryData(["google-sign-in", projectId, environment], settings);
      await queryClient.invalidateQueries({ queryKey: ["google-sign-in", projectId, environment] });
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Settings could not be saved."),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(settingsPath(projectId, environment), { method: "DELETE" });
      if (!response.ok) throw new Error("Registration could not be removed.");
      return fetch(settingsPath(projectId, environment), { cache: "no-store" }).then((result) => result.json() as Promise<Settings>);
    },
    onSuccess: (settings) => {
      setRedirectUris("");
      setDisplayName("");
      setUseOwnClient(false);
      setClientId("");
      setClientSecret("");
      setFeedback("Registration removed.");
      queryClient.setQueryData(["google-sign-in", projectId, environment], settings);
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Registration could not be removed."),
  });

  const settings = settingsQuery.data;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Project and environment</CardTitle>
          <CardDescription>Choose where these Google OAuth settings apply.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium">Project
            <select aria-label="Project" className="h-9 rounded-md border bg-background px-3" value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={tribesQuery.isLoading || projects.length === 0}>
              {projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.name} · {project.projectId} ({project.tribeName})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">Environment
            <select aria-label="Environment" className="h-9 rounded-md border bg-background px-3" value={environment} onChange={(event) => setEnvironment(event.target.value as Environment)}>
              <option value="test">Test</option><option value="live">Live</option>
            </select>
          </label>
        </CardContent>
      </Card>

      {tribesQuery.isError ? <p role="alert">Projects could not be loaded.</p> : null}
      {!tribesQuery.isLoading && projects.length === 0 ? <p>No projects are available to your organization.</p> : null}
      {settingsQuery.isLoading ? <p role="status">Loading settings…</p> : null}
      {settingsQuery.isError ? <p role="alert">Google sign-in settings could not be loaded.</p> : null}

      {settings ? <Card>
        <CardHeader>
          <CardTitle>OAuth settings</CardTitle>
          <CardDescription>This project currently uses {settings.hasOwnClient ? "its own Google client" : "the APICenter Google client"} for {environment} sign-in.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <label className="flex flex-col gap-2 text-sm font-medium">Redirect URLs <span className="text-xs font-normal text-muted-foreground">Enter one URL per line.</span>
            <Textarea aria-label="Redirect URLs" value={redirectUris} onChange={(event) => setRedirectUris(event.target.value)} rows={4} />
          </label>
          <label className="flex items-center gap-3 text-sm font-medium">
            <input aria-label="Use your own Google client" type="checkbox" checked={useOwnClient} onChange={(event) => setUseOwnClient(event.target.checked)} />
            Use your own Google client
          </label>
          {useOwnClient ? <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium">Client ID
              <Input aria-label="Client ID" value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">Client secret <span className="text-xs font-normal text-muted-foreground">Write-only. Leave blank to keep the current secret.</span>
              <Input aria-label="Client secret" type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} autoComplete="new-password" />
            </label>
          </div> : null}
          {settings.secretLastChangedAt ? <p className="text-sm text-muted-foreground">Client secret last changed {new Date(settings.secretLastChangedAt).toLocaleString()}.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || settingsQuery.isLoading || !projectId}>Save settings</Button>
            <Button variant="outline" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending || !projectId}>Remove registration</Button>
          </div>
          {feedback ? <p role="status">{feedback}</p> : null}
        </CardContent>
      </Card> : null}
    </div>
  );
}

function settingsPath(projectId: string, environment: Environment) {
  return `/api/local/google-sign-in/projects/${encodeURIComponent(projectId)}/${environment}`;
}
