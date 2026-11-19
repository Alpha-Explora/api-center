"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/api-center/client-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormRow } from "@/components/patterns/form";
import { Notice } from "@/components/patterns/notices";
import { projectHref } from "@/lib/app-navigation";
import { SLUG_PATTERN, toSlug } from "@/lib/format";
import { publishedApis, type UpdateApiInput } from "../../data/published-apis";
import {
  draftsFrom,
  hasOperationErrors,
  newOperationDraft,
  operationsChanged,
  toOperationsBody,
  upstreamUrlError,
  validateOperations,
  type OperationDraft,
  type PublishedApi,
} from "../../model/published-apis";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { apiKeys } from "../../view-models/published-apis";
import { OperationsEditor } from "./operations-editor";

type FieldErrors = { slug?: string; upstream?: string };

/** Gateway refusals that belong to one field; anything else is a toast. */
function fieldErrorFrom(error: Error): FieldErrors | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === "UPSTREAM_NOT_ALLOWED") return { upstream: `${error.message}. The gateway resolves the host and refuses private addresses.` };
  if (error.code === "CONFLICT") return { slug: "Another API in this environment already uses this slug." };
  return undefined;
}

/** Publish a new API in this environment. */
export function PublishApiSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">{open ? <PublishForm onDone={() => onOpenChange(false)} /> : null}</SheetContent>
    </Sheet>
  );
}

/** Change an API's upstream and operations. Saving operations replaces all of them. */
export function EditApiSheet({ api, open, onOpenChange }: { api: PublishedApi; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">{open ? <EditForm api={api} onDone={() => onOpenChange(false)} /> : null}</SheetContent>
    </Sheet>
  );
}

function PublishForm({ onDone }: { onDone: () => void }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const client = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [upstreamUrl, setUpstreamUrl] = useState("");
  const [rows, setRows] = useState<OperationDraft[]>(() => [newOperationDraft()]);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const publish = useMutation({
    mutationFn: () =>
      publishedApis.publish(organizationId, project.id, kind, { name: name.trim(), slug, upstreamUrl: upstreamUrl.trim(), operations: toOperationsBody(rows) }),
    onSuccess: (api) => {
      toast.success(`Published ${api.name}`);
      void client.invalidateQueries({ queryKey: apiKeys.list(organizationId, project.id, kind) });
      void client.invalidateQueries({ queryKey: apiKeys.catalog(organizationId) });
      onDone();
      router.push(projectHref(project.id, kind, `/apis/${api.id}`));
    },
    onError: (error: Error) => {
      const fields = fieldErrorFrom(error);
      if (fields) setServerErrors(fields);
      else toast.error(error.message);
    },
  });

  const operations = validateOperations(rows);
  const nameError = !name.trim() ? "Enter a name." : name.trim().length > 128 ? "At most 128 characters." : undefined;
  const slugError = SLUG_PATTERN.test(slug) ? serverErrors.slug : "Use lowercase letters, numbers and dashes.";
  const upstreamError = upstreamUrlError(upstreamUrl) ?? serverErrors.upstream;
  const invalid = Boolean(nameError || slugError || upstreamError) || hasOperationErrors(operations);

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (!invalid) publish.mutate();
      }}
    >
      <SheetHeader>
        <SheetTitle>Publish a {kind} API</SheetTitle>
        <SheetDescription>
          Applications call it through APICenter with their {kind} keys. Each operation maps a request to an action you grant like a capability action.
        </SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        <FormRow label="Name" htmlFor="api-name" error={attempted ? nameError : undefined}>
          <Input
            id="api-name"
            autoFocus
            placeholder="Orders API"
            value={name}
            aria-invalid={attempted && Boolean(nameError)}
            onChange={(event) => {
              setName(event.target.value);
              if (!slugEdited) {
                setSlug(toSlug(event.target.value));
                setServerErrors((current) => ({ ...current, slug: undefined }));
              }
            }}
          />
        </FormRow>
        <FormRow label="Slug" htmlFor="api-slug" hint="Unique in this environment." error={(attempted || slug) && slugError ? slugError : undefined}>
          <Input
            id="api-slug"
            className="font-mono"
            value={slug}
            aria-invalid={Boolean((attempted || slug) && slugError)}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(event.target.value);
              setServerErrors((current) => ({ ...current, slug: undefined }));
            }}
          />
        </FormRow>
        <UpstreamField
          value={upstreamUrl}
          onChange={(value) => {
            setUpstreamUrl(value);
            setServerErrors((current) => ({ ...current, upstream: undefined }));
          }}
          error={attempted || upstreamUrl ? upstreamError : undefined}
        />
        <OperationsEditor rows={rows} onChange={setRows} errors={operations.rows} formError={operations.form} showErrors={attempted} />
      </div>
      <SheetFooter className="flex-row justify-end border-t">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={publish.isPending}>
          {publish.isPending ? "Publishing…" : "Publish API"}
        </Button>
      </SheetFooter>
    </form>
  );
}

function EditForm({ api, onDone }: { api: PublishedApi; onDone: () => void }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const client = useQueryClient();
  const [upstreamUrl, setUpstreamUrl] = useState(api.upstreamUrl);
  const [rows, setRows] = useState<OperationDraft[]>(() => draftsFrom(api.operations));
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});

  const upstreamChanged = upstreamUrl.trim() !== api.upstreamUrl;
  const opsChanged = operationsChanged(api.operations, rows);
  const update = useMutation({
    mutationFn: () => {
      const input: UpdateApiInput = {
        ...(upstreamChanged ? { upstreamUrl: upstreamUrl.trim() } : {}),
        ...(opsChanged ? { operations: toOperationsBody(rows) } : {}),
      };
      return publishedApis.update(organizationId, project.id, kind, api.id, input);
    },
    onSuccess: (updated) => {
      toast.success(`Saved ${updated.name}`);
      void client.invalidateQueries({ queryKey: apiKeys.list(organizationId, project.id, kind) });
      void client.invalidateQueries({ queryKey: apiKeys.catalog(organizationId) });
      onDone();
    },
    onError: (error: Error) => {
      const fields = fieldErrorFrom(error);
      if (fields?.upstream) setServerErrors(fields);
      else toast.error(error.message);
    },
  });

  const operations = validateOperations(rows);
  const upstreamError = upstreamChanged ? (upstreamUrlError(upstreamUrl) ?? serverErrors.upstream) : undefined;
  const invalid = Boolean(upstreamError) || hasOperationErrors(operations);
  const removedActions = [...new Set(api.operations.map((operation) => operation.action))].filter((action) => !rows.some((row) => row.action.trim() === action));

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (!invalid) update.mutate();
      }}
    >
      <SheetHeader>
        <SheetTitle>Edit {api.name}</SheetTitle>
        <SheetDescription>Changes apply to the next request. The slug and name cannot be changed.</SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        <UpstreamField
          value={upstreamUrl}
          onChange={(value) => {
            setUpstreamUrl(value);
            setServerErrors({});
          }}
          error={upstreamError}
        />
        <Notice title="Saving replaces every operation">
          The gateway stores exactly the rows below. A request that matches no row is refused.
        </Notice>
        {opsChanged && removedActions.length > 0 ? (
          <Notice tone="warning" title="Some actions are no longer declared">
            No operation uses <span className="font-mono">{removedActions.join(", ")}</span> any more. Applications granted only these actions cannot call this API.
          </Notice>
        ) : null}
        <OperationsEditor rows={rows} onChange={setRows} errors={operations.rows} formError={operations.form} showErrors={attempted || opsChanged} />
      </div>
      <SheetFooter className="flex-row justify-end border-t">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending || (!upstreamChanged && !opsChanged)}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </SheetFooter>
    </form>
  );
}

function UpstreamField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  return (
    <FormRow
      label="Upstream URL"
      htmlFor="api-upstream"
      hint="A public https address. APICenter forwards matching requests here with a signed context; private and internal hosts are refused."
      error={error}
    >
      <Input
        id="api-upstream"
        type="url"
        inputMode="url"
        className="font-mono"
        placeholder="https://orders.example.com"
        value={value}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormRow>
  );
}
