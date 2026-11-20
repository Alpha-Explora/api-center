"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { IdText } from "@/components/patterns/copy-button";
import { FormRow } from "@/components/patterns/form";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { DescriptionList } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime, formatRelative } from "@/lib/format";
import { capabilityConfiguration } from "../../data/capability-configuration";
import { environmentWriteReason } from "../../model/access";
import {
  MAX_DISPLAY_NAME,
  MAX_REDIRECT_URIS,
  gauthBody,
  gauthFormFrom,
  gauthFormSchema,
  needsClientSecret,
  resetsToSharedClient,
  type GauthClientMode,
  type GauthConfiguration,
  type GauthForm,
} from "../../model/capability-configuration";
import type { EnvironmentKind } from "../../model/control-plane";
import { fieldErrors } from "../../model/form-errors";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";

export const gauthConfigurationKey = (organizationId: string, projectId: string, kind: EnvironmentKind) =>
  [...cpKeys.environment(organizationId, projectId, kind), "configuration", "gauth"] as const;

const CLIENT_MODES: {
  value: GauthClientMode;
  label: string;
  description: string;
}[] = [
  {
    value: "shared",
    label: "Shared APICenter client",
    description: "Google's consent screen names APICenter's app. Nothing to set up.",
  },
  {
    value: "own",
    label: "Your own OAuth client",
    description: "Google's consent screen names your app. Needs a client ID and secret from Google Cloud.",
  },
];

/** The environment's Google sign-in OAuth app: current settings from the runtime, and the form to change them. */
export function GoogleSignInSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const configuration = useQuery({
    queryKey: gauthConfigurationKey(organizationId, project.id, kind),
    queryFn: () =>
      capabilityConfiguration.gauth({
        organizationId,
        projectId: project.id,
        kind,
      }),
    enabled: open,
    retry: false,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Google sign-in</SheetTitle>
          <SheetDescription>
            The OAuth app {project.name} uses for Google sign-in in {kind}. Test and live are configured separately.
          </SheetDescription>
        </SheetHeader>
        {configuration.error ? (
          <div className="px-4">
            <ErrorPanel title="Google sign-in settings could not be loaded" error={configuration.error} />
          </div>
        ) : !configuration.data ? (
          <div className="flex flex-col gap-3 px-4" aria-busy="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          // Keyed by fetch time so the form restarts from the saved settings after each save.
          <GoogleSignInForm key={`${project.id}:${kind}`} current={configuration.data} onDone={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function GoogleSignInForm({ current, onDone }: { current: GauthConfiguration; onDone: () => void }) {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const client = useQueryClient();
  const scope = { organizationId, projectId: project.id, kind };
  const key = gauthConfigurationKey(organizationId, project.id, kind);
  const [form, setForm] = useState<GauthForm>(() => gauthFormFrom(current));
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState<"save" | "delete" | null>(null);
  const registered = current.registered ?? current.redirectUris.length > 0;

  const save = useMutation({
    mutationFn: () => capabilityConfiguration.saveGauth(scope, gauthBody(form, current)),
    onSettled: () => setConfirm(null),
    onSuccess: () => {
      toast.success(`Saved Google sign-in for ${kind}`);
      void client.invalidateQueries({ queryKey: key });
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => capabilityConfiguration.deleteGauth(scope),
    onSettled: () => setConfirm(null),
    onSuccess: () => {
      toast.success(`Removed Google sign-in from ${kind}`);
      void client.invalidateQueries({ queryKey: key });
      onDone();
    },
  });

  const parsed = gauthFormSchema(kind, current).safeParse(form);
  const errors = submitted ? fieldErrors(parsed.error) : {};
  const secretRequired = needsClientSecret(form, current);
  const resetting = resetsToSharedClient(form, current);
  const set = (patch: Partial<GauthForm>) => setForm({ ...form, ...patch });

  return (
    <>
      <form
        noValidate
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (!parsed.success) return;
          if (resetting || kind === "live") setConfirm("save");
          else save.mutate();
        }}
      >
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
          {registered ? (
            <section className="rounded-lg border p-3">
              <DescriptionList
                items={[
                  {
                    label: "Status",
                    value: registered ? <StatusBadge tone="success">Registered</StatusBadge> : <StatusBadge tone="neutral">Not set up</StatusBadge>,
                  },
                  {
                    label: "OAuth client",
                    value: current.clientId ? (
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span>Your own client</span>
                        <IdText value={current.clientId} />
                      </span>
                    ) : (
                      "Shared APICenter client"
                    ),
                  },
                  ...(current.clientId
                    ? [
                        {
                          label: "Client secret",
                          value: current.secretLastChangedAt ? (
                            <span title={formatDateTime(current.secretLastChangedAt)}>Changed {formatRelative(current.secretLastChangedAt)}</span>
                          ) : (
                            "Stored"
                          ),
                        },
                      ]
                    : []),
                  { label: "Display name", value: current.displayName || "—" },
                  {
                    label: "Redirect URIs",
                    value: current.redirectUris.length ? (
                      <ul className="flex flex-col gap-0.5 font-mono text-xs">
                        {current.redirectUris.map((uri) => (
                          <li key={uri} className="break-all">
                            {uri}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "None"
                    ),
                  },
                ]}
              />
            </section>
          ) : (
            <Notice title="Google sign-in is not set up in this environment">
              {canWrite ? "Add at least one redirect URI and save to register it." : null}
            </Notice>
          )}
          {registered && current.credentialSettingsConfigured === false ? (
            <Notice tone="warning" title="Sign-in can't complete yet">
              No OAuth client is available for this environment. Add your own client ID and secret below.
            </Notice>
          ) : null}

          {canWrite ? (
            <>
              <FormRow
                label="Redirect URIs"
                htmlFor="gauth-redirects"
                error={errors.redirectUris}
                hint={`One per line, up to ${MAX_REDIRECT_URIS}. https only${kind === "test" ? "; test also allows http://localhost" : ""}. No #fragment.`}
              >
                <Textarea
                  id="gauth-redirects"
                  rows={4}
                  spellCheck={false}
                  className="font-mono md:text-xs"
                  placeholder="https://app.yourcompany.com/auth/callback"
                  value={form.redirectUris}
                  aria-invalid={Boolean(errors.redirectUris)}
                  onChange={(event) => set({ redirectUris: event.target.value })}
                />
              </FormRow>
              <FormRow label="Display name" htmlFor="gauth-name" error={errors.displayName} hint="A label for this OAuth app. Defaults to “Google sign-in”.">
                <Input
                  id="gauth-name"
                  maxLength={MAX_DISPLAY_NAME}
                  placeholder="Google sign-in"
                  value={form.displayName}
                  onChange={(event) => set({ displayName: event.target.value })}
                />
              </FormRow>
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1.5 text-[13px] font-medium">OAuth client</legend>
                {CLIENT_MODES.map((mode) => (
                  <label
                    key={mode.value}
                    className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-[13px] has-checked:border-foreground/40 has-checked:bg-muted/60"
                  >
                    <input
                      type="radio"
                      name="gauth-client"
                      className="mt-0.5 accent-foreground"
                      checked={form.clientMode === mode.value}
                      onChange={() => set({ clientMode: mode.value })}
                    />
                    <span>
                      <span className="block font-medium">{mode.label}</span>
                      <span className="block text-xs text-muted-foreground">{mode.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {form.clientMode === "own" ? (
                <div className="flex flex-col gap-4 border-l-2 pl-3">
                  <FormRow label="Client ID" htmlFor="gauth-client-id" error={errors.clientId}>
                    <Input
                      id="gauth-client-id"
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono md:text-xs"
                      placeholder="1234567890-abc.apps.googleusercontent.com"
                      value={form.clientId}
                      aria-invalid={Boolean(errors.clientId)}
                      onChange={(event) => set({ clientId: event.target.value })}
                    />
                  </FormRow>
                  <FormRow
                    label={secretRequired ? "Client secret" : "New client secret (optional)"}
                    htmlFor="gauth-client-secret"
                    error={errors.clientSecret}
                    hint={
                      secretRequired
                        ? "Required for a new client ID. It is stored by the sign-in service and never shown again."
                        : "Leave empty to keep the stored secret. It is never shown."
                    }
                  >
                    <Input
                      id="gauth-client-secret"
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={form.clientSecret}
                      aria-invalid={Boolean(errors.clientSecret)}
                      onChange={(event) => set({ clientSecret: event.target.value })}
                    />
                  </FormRow>
                </div>
              ) : resetting ? (
                <Notice tone="warning">Saving switches to the shared client and deletes your stored client secret.</Notice>
              ) : null}
              {save.error ? <ErrorPanel title="Google sign-in was not saved" error={save.error} /> : null}

              {registered ? (
                <section className="mt-2 flex flex-col gap-2 border-t pt-4">
                  <p className="text-[13px] font-medium">Remove Google sign-in</p>
                  <p className="text-xs text-muted-foreground">
                    Deletes this environment&apos;s OAuth app registration and any stored client secret. Sign-in stops working until it is set up again.
                  </p>
                  {remove.error ? <ErrorPanel title="Google sign-in was not removed" error={remove.error} /> : null}
                  <div>
                    <Button type="button" size="sm" variant="outline" className="text-danger" onClick={() => setConfirm("delete")}>
                      Remove…
                    </Button>
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <Notice>{environmentWriteReason(kind)} You can view these settings.</Notice>
          )}
        </div>
        <SheetFooter className="flex-row justify-end border-t">
          <Button type="button" variant="outline" onClick={onDone}>
            {canWrite ? "Cancel" : "Close"}
          </Button>
          {canWrite ? (
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </SheetFooter>
      </form>
      <ConfirmDialog
        open={confirm === "save"}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={resetting ? `Switch ${project.name} ${kind} to the shared client` : `Save live Google sign-in for ${project.name}`}
        description={
          resetting
            ? "Your OAuth client ID and stored secret are removed. Sign-in uses the shared APICenter client from now on."
            : "Live sign-in uses these settings from the next sign-in."
        }
        confirmLabel={resetting ? "Switch to shared client" : "Save"}
        destructive={resetting}
        busy={save.isPending}
        onConfirm={() => save.mutate()}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={`Remove Google sign-in from ${project.name} ${kind}`}
        description="The OAuth app registration and any stored client secret are deleted. Sign-in in this environment stops working."
        confirmLabel="Remove Google sign-in"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
