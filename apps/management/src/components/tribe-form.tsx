"use client";

import { useRouter } from "next/navigation";
import { AlertTriangleIcon, PlusIcon, WandSparklesIcon } from "lucide-react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { registerService } from "@/lib/api-center-client";
import {
  knownSharedServiceIds,
  sharedServiceOptions,
  smokeTribePreset,
} from "@/lib/service-form-presets";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  isOwnerTribeIdRequiredForManifest,
  type ServiceManifest,
  type ServiceRegistryEntry,
} from "@/lib/schemas";
import { ManifestDiffPanel } from "@/components/tribe-form/manifest-diff-panel";
import {
  formSchema,
  type FormInput,
  type FormOutput,
} from "@/components/tribe-form/tribe-form-schema";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const defaultValues: FormInput = {
  serviceId: "",
  name: "",
  baseUrl: "",
  serviceType: "tribe",
  ownerTribeId: "",
  ownerTeam: "",
  contact: "",
  version: "1.0.0",
  serviceTier: "standard",
  costCenter: "",
  healthCheck: "/health",
  environments: [
    {
      environment: "test",
      baseUrl: "",
      healthCheck: "/health",
    },
  ],
  description: "",
  exposesText: "/health",
  requiredScopesText: "service:read",
  sharedConsumes: [],
  extraConsumesText: "",
  tagsText: "",
};

function toFormDefaults(service?: ServiceRegistryEntry | ServiceManifest): FormInput {
  if (!service) return defaultValues;
  const knownSharedIds = new Set<string>(knownSharedServiceIds);
  const sharedConsumes = service.consumes.filter((serviceId) =>
    knownSharedIds.has(serviceId),
  );
  const extraConsumes = service.consumes.filter(
    (serviceId) => !knownSharedIds.has(serviceId),
  );
  const ownerTribeId =
    service.ownerTribeId ??
    (isOwnerTribeIdRequiredForManifest({
      serviceId: service.serviceId,
      serviceType: service.serviceType,
    })
      ? service.serviceId
      : "");

  return {
    serviceId: service.serviceId,
    name: service.name,
    baseUrl: service.baseUrl,
    serviceType: service.serviceType ?? "tribe",
    ownerTribeId,
    ownerTeam: service.ownerTeam ?? "",
    contact: service.contact ?? "",
    version: service.version ?? "1.0.0",
    serviceTier: service.serviceTier ?? "standard",
    costCenter: service.costCenter ?? "",
    healthCheck: service.healthCheck ?? "/health",
    environments:
      service.environments && service.environments.length > 0
        ? service.environments.map((environment) => ({
            environment: environment.environment,
            baseUrl: environment.baseUrl,
            healthCheck: environment.healthCheck ?? service.healthCheck ?? "/health",
          }))
        : [
            {
              environment: "test",
              baseUrl: service.baseUrl,
              healthCheck: service.healthCheck ?? "/health",
            },
          ],
    description: service.description ?? "",
    exposesText: service.exposes.join(","),
    requiredScopesText: service.requiredScopes.join(","),
    sharedConsumes,
    extraConsumesText: extraConsumes.join(","),
    tagsText: service.tags?.join(",") ?? "",
  };
}

export function TribeForm({
  initialValue,
  mode = "create",
}: {
  initialValue?: ServiceRegistryEntry;
  mode?: "create" | "edit";
}) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormDefaults(initialValue),
  });
  const environmentFields = useFieldArray({
    control: form.control,
    name: "environments",
  });
  const watchedValues = useWatch({ control: form.control });
  const watchedEnvironments =
    useWatch({ control: form.control, name: "environments" }) ?? [];

  async function onSubmit(values: FormOutput) {
    try {
      const service = await registerService(values);
      toast.success(mode === "edit" ? "Service updated" : "Service registered");
      router.push(`/tribes/${service.serviceId}`);
    } catch (error) {
      toast.error("Registration failed", {
        description:
          getErrorMessage(error) ??
          "Check the manifest fields, API Center URL, and platform admin secret.",
      });
    }
  }

  const errors = form.formState.errors;
  const manifestPreview = formSchema.safeParse(watchedValues);
  const baseUrl =
    watchedEnvironments[0]?.baseUrl ?? watchedValues.baseUrl ?? "";
  const isLocalBackend =
    /(^https?:\/\/localhost[:/])|(^https?:\/\/127\.0\.0\.1[:/])/.test(baseUrl);
  function applySmokePreset() {
    form.reset(toFormDefaults(smokeTribePreset));
    toast.info("Smoke tribe preset applied");
  }

  function addEnvironment() {
    const existing = new Set(
      (form.getValues("environments") ?? []).map((row) => row.environment),
    );
    const nextEnvironment =
      (["staging", "uat", "demo", "live"] as const).find(
        (environment) => !existing.has(environment),
      ) ?? "staging";

    environmentFields.append({
      environment: nextEnvironment,
      baseUrl: "",
      healthCheck: form.getValues("healthCheck") || "/health",
    });
  }

  function removeEnvironment(index: number) {
    if (environmentFields.fields.length <= 1) return;
    environmentFields.remove(index);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>
              {mode === "edit" ? "Edit service manifest" : "Register tribe service"}
            </CardTitle>
            <CardDescription>
              Registers the backend API URL, exposed routes, scopes, and shared
              services that API Center may route for this tribe.
            </CardDescription>
          </div>
          {mode === "create" ? (
            <Button type="button" variant="outline" onClick={applySmokePreset}>
              <WandSparklesIcon data-icon="inline-start" />
              Smoke preset
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          <FieldSet>
            <FieldTitle>Service identity</FieldTitle>
            <FieldGroup>
              <div className="grid gap-5 md:grid-cols-2">
                <Field data-invalid={Boolean(errors.serviceId)}>
                  <FieldLabel htmlFor="serviceId">Service ID</FieldLabel>
                  <Input
                    id="serviceId"
                    placeholder="campusone-students"
                    aria-invalid={Boolean(errors.serviceId)}
                    readOnly={mode === "edit"}
                    aria-readonly={mode === "edit"}
                    {...form.register("serviceId")}
                  />
                  <FieldDescription>
                    Lowercase letters, numbers, and hyphens only.
                  </FieldDescription>
                  <FieldError errors={[errors.serviceId]} />
                </Field>

                <Field data-invalid={Boolean(errors.name)}>
                  <FieldLabel htmlFor="name">Service name</FieldLabel>
                  <Input
                    id="name"
                    placeholder="CampusOne Students API"
                    aria-invalid={Boolean(errors.name)}
                    {...form.register("name")}
                  />
                  <FieldError errors={[errors.name]} />
                </Field>
              </div>

              <div className="grid gap-5 md:grid-cols-3">
                <Field data-invalid={Boolean(errors.serviceType)}>
                  <FieldLabel htmlFor="serviceType">Type</FieldLabel>
                  <select
                    id="serviceType"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    aria-invalid={Boolean(errors.serviceType)}
                    {...form.register("serviceType")}
                  >
                    <option value="tribe">tribe</option>
                    <option value="shared">shared</option>
                  </select>
                  <FieldError errors={[errors.serviceType]} />
                </Field>

                <Field data-invalid={Boolean(errors.version)}>
                  <FieldLabel htmlFor="version">Version</FieldLabel>
                  <Input
                    id="version"
                    aria-invalid={Boolean(errors.version)}
                    {...form.register("version")}
                  />
                  <FieldError errors={[errors.version]} />
                </Field>

                <Field data-invalid={Boolean(errors.serviceTier)}>
                  <FieldLabel htmlFor="serviceTier">Tier</FieldLabel>
                  <select
                    id="serviceTier"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    aria-invalid={Boolean(errors.serviceTier)}
                    {...form.register("serviceTier")}
                  >
                    <option value="standard">standard</option>
                    <option value="critical">critical</option>
                    <option value="experimental">experimental</option>
                  </select>
                  <FieldError errors={[errors.serviceTier]} />
                </Field>
              </div>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldTitle>Environments</FieldTitle>
            <FieldDescription>
              Register the runtime URLs this service exposes through API Center.
            </FieldDescription>
            <FieldGroup>
              {environmentFields.fields.map((field, index) => {
                const selectedEnvironment =
                  watchedEnvironments[index]?.environment ?? field.environment;
                const environmentError = errors.environments?.[index];

                return (
                  <div
                    key={field.id}
                    className="grid gap-4 rounded-lg border p-4 md:grid-cols-[10rem_1fr_12rem_auto]"
                  >
                    <Field data-invalid={Boolean(environmentError?.environment)}>
                      <FieldLabel htmlFor={`environment-${index}`}>
                        Environment key for row {index + 1}
                      </FieldLabel>
                      <select
                        id={`environment-${index}`}
                        className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                        aria-invalid={Boolean(environmentError?.environment)}
                        {...form.register(`environments.${index}.environment`)}
                      >
                        <option value="test">test</option>
                        <option value="staging">staging</option>
                        <option value="uat">uat</option>
                        <option value="demo">demo</option>
                        <option value="live">live</option>
                      </select>
                      <FieldError errors={[environmentError?.environment]} />
                    </Field>

                    <Field data-invalid={Boolean(environmentError?.baseUrl)}>
                      <FieldLabel htmlFor={`environment-url-${index}`}>
                        Environment URL for {selectedEnvironment}
                      </FieldLabel>
                      <Input
                        id={`environment-url-${index}`}
                        placeholder="https://api.campusone.itsandbox.site"
                        aria-invalid={Boolean(environmentError?.baseUrl)}
                        {...form.register(`environments.${index}.baseUrl`)}
                      />
                      <FieldError errors={[environmentError?.baseUrl]} />
                    </Field>

                    <Field data-invalid={Boolean(environmentError?.healthCheck)}>
                      <FieldLabel htmlFor={`environment-health-${index}`}>
                        Health path
                      </FieldLabel>
                      <Input
                        id={`environment-health-${index}`}
                        aria-invalid={Boolean(environmentError?.healthCheck)}
                        {...form.register(`environments.${index}.healthCheck`)}
                      />
                      <FieldError errors={[environmentError?.healthCheck]} />
                    </Field>

                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => removeEnvironment(index)}
                        disabled={environmentFields.fields.length <= 1}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}

              <div>
                <Button type="button" variant="outline" onClick={addEnvironment}>
                  <PlusIcon data-icon="inline-start" />
                  Add environment
                </Button>
              </div>

              {isLocalBackend ? (
                <Alert>
                  <AlertTriangleIcon data-icon="inline-start" />
                  <AlertTitle>Local backend URL</AlertTitle>
                  <AlertDescription>
                    This is fine for local registry and token testing. A
                    production API Center proxy running in GKE cannot reach your
                    laptop unless you expose a tunnel or deploy the tribe
                    backend.
                  </AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldTitle>Ownership</FieldTitle>
            <FieldGroup>
              <div className="grid gap-5 md:grid-cols-2">
                <Field data-invalid={Boolean(errors.ownerTribeId)}>
                  <FieldLabel htmlFor="ownerTribeId">Owner tribe ID</FieldLabel>
                  <Input
                    id="ownerTribeId"
                    placeholder="campusone"
                    aria-invalid={Boolean(errors.ownerTribeId)}
                    {...form.register("ownerTribeId")}
                  />
                  <FieldDescription>
                    For a tribe principal, use the service ID. For a microservice,
                    use the owning tribe ID.
                  </FieldDescription>
                  <FieldError errors={[errors.ownerTribeId]} />
                </Field>

                <Field data-invalid={Boolean(errors.ownerTeam)}>
                  <FieldLabel htmlFor="ownerTeam">Owner team</FieldLabel>
                  <Input
                    id="ownerTeam"
                    placeholder="campusone"
                    aria-invalid={Boolean(errors.ownerTeam)}
                    {...form.register("ownerTeam")}
                  />
                  <FieldError errors={[errors.ownerTeam]} />
                </Field>
                <Field data-invalid={Boolean(errors.contact)}>
                  <FieldLabel htmlFor="contact">Contact</FieldLabel>
                  <Input
                    id="contact"
                    placeholder="owner@campusone.test"
                    aria-invalid={Boolean(errors.contact)}
                    {...form.register("contact")}
                  />
                  <FieldError errors={[errors.contact]} />
                </Field>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <Field data-invalid={Boolean(errors.costCenter)}>
                  <FieldLabel htmlFor="costCenter">Cost center</FieldLabel>
                  <Input
                    id="costCenter"
                    placeholder="CAMPUSONE"
                    aria-invalid={Boolean(errors.costCenter)}
                    {...form.register("costCenter")}
                  />
                  <FieldError errors={[errors.costCenter]} />
                </Field>
                <Field data-invalid={Boolean(errors.healthCheck)}>
                  <FieldLabel htmlFor="healthCheck">Health path</FieldLabel>
                  <Input
                    id="healthCheck"
                    aria-invalid={Boolean(errors.healthCheck)}
                    {...form.register("healthCheck")}
                  />
                  <FieldError errors={[errors.healthCheck]} />
                </Field>
              </div>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldTitle>Routes and access</FieldTitle>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.exposesText)}>
                <FieldLabel htmlFor="exposesText">Exposed routes</FieldLabel>
                <Input
                  id="exposesText"
                  placeholder="/students,/students/:id"
                  aria-invalid={Boolean(errors.exposesText)}
                  {...form.register("exposesText")}
                />
                <FieldDescription>Comma-separated route patterns.</FieldDescription>
                <FieldError errors={[errors.exposesText]} />
              </Field>

              <Field data-invalid={Boolean(errors.requiredScopesText)}>
                <FieldLabel htmlFor="requiredScopesText">
                  Required scopes
                </FieldLabel>
                <Input
                  id="requiredScopesText"
                  placeholder="students:read,students:write"
                  aria-invalid={Boolean(errors.requiredScopesText)}
                  {...form.register("requiredScopesText")}
                />
                <FieldDescription>
                  API Center requires at least one scope.
                </FieldDescription>
                <FieldError errors={[errors.requiredScopesText]} />
              </Field>

              <Field data-invalid={Boolean(errors.sharedConsumes)}>
                <FieldLabel>Shared services this tribe can call</FieldLabel>
                <div className="grid gap-3 md:grid-cols-2">
                  {sharedServiceOptions.map((option) => {
                    const optionInputId = `sharedConsumes-${option.serviceId}`;
                    return (
                      <label
                        key={option.serviceId}
                        htmlFor={optionInputId}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 text-sm"
                      >
                        <input
                          id={optionInputId}
                          type="checkbox"
                          value={option.serviceId}
                          aria-label={option.label}
                          className="mt-1"
                          {...form.register("sharedConsumes")}
                        />
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="font-medium">{option.label}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {option.serviceId}
                          </span>
                          <span className="text-muted-foreground">
                            {option.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <FieldDescription>
                  These manifest links drive shared-service authorization and
                  the usage matrix.
                </FieldDescription>
                <FieldError errors={[errors.sharedConsumes]} />
              </Field>

              <Field data-invalid={Boolean(errors.extraConsumesText)}>
                <FieldLabel htmlFor="extraConsumesText">
                  Other service dependencies
                </FieldLabel>
                <Input
                  id="extraConsumesText"
                  placeholder="campusone-catalog,trinithrive-profile"
                  aria-invalid={Boolean(errors.extraConsumesText)}
                  {...form.register("extraConsumesText")}
                />
                <FieldDescription>
                  Optional comma-separated tribe or internal service IDs.
                </FieldDescription>
                <FieldError errors={[errors.extraConsumesText]} />
              </Field>

              <div className="grid gap-5 md:grid-cols-2">
                <Field data-invalid={Boolean(errors.tagsText)}>
                  <FieldLabel htmlFor="tagsText">Tags</FieldLabel>
                  <Input
                    id="tagsText"
                    placeholder="students,core"
                    aria-invalid={Boolean(errors.tagsText)}
                    {...form.register("tagsText")}
                  />
                  <FieldError errors={[errors.tagsText]} />
                </Field>
              </div>

              <Field data-invalid={Boolean(errors.description)}>
                <FieldLabel htmlFor="description">Description</FieldLabel>
                <Textarea
                  id="description"
                  aria-invalid={Boolean(errors.description)}
                  {...form.register("description")}
                />
                <FieldError errors={[errors.description]} />
              </Field>
            </FieldGroup>
          </FieldSet>

          {mode === "edit" && manifestPreview.success ? (
            <ManifestDiffPanel current={initialValue} next={manifestPreview.data} />
          ) : null}

          <details className="rounded-lg border bg-muted/25 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Manifest preview
            </summary>
            {manifestPreview.success ? (
              <pre className="mt-4 max-h-96 overflow-auto rounded-md border bg-background p-3 text-xs">
                {JSON.stringify(manifestPreview.data, null, 2)}
              </pre>
            ) : (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Preview is waiting for valid fields</AlertTitle>
                <AlertDescription>
                  Complete the required fields to see the manifest that will be
                  submitted to API Center.
                </AlertDescription>
              </Alert>
            )}
          </details>

          <div className="flex justify-end">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              <PlusIcon data-icon="inline-start" />
              {mode === "edit" ? "Update service" : "Register service"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : undefined;
}
