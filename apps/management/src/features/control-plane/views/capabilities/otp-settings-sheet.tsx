"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SmsDeliverySettings } from "./sms-delivery-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormRow } from "@/components/patterns/form";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { DescriptionList } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { capabilityConfiguration } from "../../data/capability-configuration";
import { PROJECT_ADMIN_REASON, environmentWriteReason } from "../../model/access";
import { fieldErrors } from "../../model/form-errors";
import {
  OTP_BOUNDS,
  effectiveOtpSettings,
  otpMessagePreview,
  otpSettingsBody,
  otpSettingsFormFrom,
  otpSettingsFormSchema,
  type OtpSettings,
  type OtpSettingsForm,
} from "../../model/otp-settings";
import { configurationKey } from "../../view-models/configuration-key";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { useAccess } from "../../view-models/use-organization";

/** The environment's OTP settings from the OTP runtime, and the form to change or reset them. */
export function OtpSettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const settings = useQuery({
    queryKey: configurationKey(organizationId, project.id, kind, "otp"),
    queryFn: () => capabilityConfiguration.otpSettings({ organizationId, projectId: project.id, kind }),
    enabled: open,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>One-time codes</SheetTitle>
          <SheetDescription>
            How {project.name} generates and checks one-time codes in {kind}. Empty fields use the platform default.
          </SheetDescription>
        </SheetHeader>
        {settings.error ? (
          <div className="px-4">
            <ErrorPanel title="OTP settings could not be loaded" error={settings.error} />
          </div>
        ) : !settings.data ? (
          <div className="flex flex-col gap-3 px-4" aria-busy="true">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <OtpSettingsForm key={`${project.id}:${kind}`} current={settings.data} onDone={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

const describeAttempts = (value: number | null) =>
  value === null
    ? `${OTP_BOUNDS.maxAttempts.default} wrong codes (platform default)`
    : `${value} wrong code${value === 1 ? "" : "s"}`;

function OtpSettingsForm({ current, onDone }: { current: OtpSettings; onDone: () => void }) {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  // The message goes out through APICenter's own senders, so changing it needs a project admin even in test.
  const canEditMessage = useAccess(organizationId).access.canManageProject(project.id);
  const client = useQueryClient();
  const scope = { organizationId, projectId: project.id, kind };
  const [form, setForm] = useState<OtpSettingsForm>(() => otpSettingsFormFrom(current));
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState<"save" | "reset" | null>(null);
  const finish = (message: string) => {
    toast.success(message);
    void client.invalidateQueries({ queryKey: configurationKey(organizationId, project.id, kind, "otp") });
    onDone();
  };
  const save = useMutation({
    mutationFn: () => capabilityConfiguration.saveOtpSettings(scope, otpSettingsBody(form)),
    onSettled: () => setConfirm(null),
    onSuccess: () => finish(`Saved OTP settings for ${kind}`),
  });
  const reset = useMutation({
    mutationFn: () => capabilityConfiguration.resetOtpSettings(scope),
    onSettled: () => setConfirm(null),
    onSuccess: () => finish(`OTP in ${kind} uses the platform defaults again`),
  });
  const parsed = otpSettingsFormSchema.safeParse(form);
  const errors = submitted ? fieldErrors(parsed.error) : {};
  const { defaults } = current;
  const effective = effectiveOtpSettings(form, defaults);
  const set = (patch: Partial<OtpSettingsForm>) => setForm({ ...form, ...patch });
  const orDefault = (value: number | null, render: (value: number) => string, fallback: string) =>
    value === null ? `${fallback} (default)` : render(value);

  return (
    <>
      <div className="px-4"><SmsDeliverySettings current={current} capability="otp" /></div>
      <form
        noValidate
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (!parsed.success) return;
          if (kind === "live") setConfirm("save");
          else save.mutate();
        }}
      >
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
          <section className="rounded-lg border p-3">
            <DescriptionList
              items={[
                {
                  label: "Status",
                  value: current.configured ? <StatusBadge tone="success">Customised</StatusBadge> : <StatusBadge tone="neutral">Platform defaults</StatusBadge>,
                },
                { label: "Code length", value: orDefault(current.codeLength, (v) => `${v} digits`, `${defaults.codeLength} digits`) },
                { label: "Expiry", value: orDefault(current.expirySeconds, (v) => `${v} seconds`, `${defaults.expirySeconds} seconds`) },
                { label: "Max attempts", value: describeAttempts(current.maxAttempts) },
                { label: "Message", value: <span className="break-words">{current.messageTemplate ?? `${defaults.messageTemplate} (default)`}</span> },
              ]}
            />
          </section>

          {canWrite ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormRow label="Code length" htmlFor="otp-length" error={errors.codeLength} hint={`${OTP_BOUNDS.codeLength.min}–${OTP_BOUNDS.codeLength.max} digits.`}>
                  <Input
                    id="otp-length"
                    inputMode="numeric"
                    placeholder={String(defaults.codeLength)}
                    value={form.codeLength}
                    aria-invalid={Boolean(errors.codeLength)}
                    onChange={(event) => set({ codeLength: event.target.value })}
                  />
                </FormRow>
                <FormRow
                  label="Expiry (s)"
                  htmlFor="otp-expiry"
                  error={errors.expirySeconds}
                  hint={`${OTP_BOUNDS.expirySeconds.min}–${OTP_BOUNDS.expirySeconds.max} seconds.`}
                >
                  <Input
                    id="otp-expiry"
                    inputMode="numeric"
                    placeholder={String(defaults.expirySeconds)}
                    value={form.expirySeconds}
                    aria-invalid={Boolean(errors.expirySeconds)}
                    onChange={(event) => set({ expirySeconds: event.target.value })}
                  />
                </FormRow>
                <FormRow
                  label="Max attempts"
                  htmlFor="otp-attempts"
                  error={errors.maxAttempts}
                  hint={`Wrong codes, ${OTP_BOUNDS.maxAttempts.min}–${OTP_BOUNDS.maxAttempts.max}.`}
                >
                  <Input
                    id="otp-attempts"
                    inputMode="numeric"
                    placeholder="No cap"
                    value={form.maxAttempts}
                    aria-invalid={Boolean(errors.maxAttempts)}
                    onChange={(event) => set({ maxAttempts: event.target.value })}
                  />
                </FormRow>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">
                A request&apos;s own <code className="font-mono">digits</code> and <code className="font-mono">ttlSeconds</code> still win over the code
                length and expiry set here. The wrong-code cap and the message always apply; after the last allowed wrong code the challenge expires.
              </p>
              <FormRow
                label="Message"
                htmlFor="otp-template"
                error={errors.messageTemplate}
                hint={
                  canEditMessage
                    ? `One line, sent by SMS and as the email body. Must include {{code}}; {{minutes}} is the expiry in minutes and {{project}} is this project's name, which also names the email's sender and subject. No links, addresses or phone numbers. Up to ${OTP_BOUNDS.messageTemplateMaxLength} characters.`
                    : `${PROJECT_ADMIN_REASON} The message is sent from APICenter's own SMS and email senders.`
                }
              >
                <Input
                  id="otp-template"
                  maxLength={OTP_BOUNDS.messageTemplateMaxLength + 20}
                  placeholder={defaults.messageTemplate}
                  value={form.messageTemplate}
                  disabled={!canEditMessage}
                  aria-invalid={Boolean(errors.messageTemplate)}
                  onChange={(event) => set({ messageTemplate: event.target.value })}
                />
              </FormRow>
              <div className="rounded-md border bg-muted/50 px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">Preview</p>
                <p className="mt-0.5 break-words text-[13px]">{otpMessagePreview(effective.template, effective.codeLength, effective.expirySeconds, project.name)}</p>
              </div>
              {save.error ? <ErrorPanel title="OTP settings were not saved" error={save.error} /> : null}
              {current.configured ? (
                <section className="mt-2 flex flex-col gap-2 border-t pt-4">
                  <p className="text-[13px] font-medium">Reset to platform defaults</p>
                  <p className="text-xs text-muted-foreground">Clears every setting above. Codes already sent keep the rules they were generated with.</p>
                  {reset.error ? <ErrorPanel title="OTP settings were not reset" error={reset.error} /> : null}
                  <div>
                    <Button type="button" size="sm" variant="outline" onClick={() => setConfirm("reset")}>
                      Reset…
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
        title={`Save live OTP settings for ${project.name}`}
        description="Codes generated from the next request use these settings. Codes already sent are unchanged."
        confirmLabel="Save"
        busy={save.isPending}
        onConfirm={() => save.mutate()}
      />
      <ConfirmDialog
        open={confirm === "reset"}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={`Reset ${kind} OTP settings for ${project.name}`}
        description="Code length, expiry, the wrong-code cap and the message go back to the platform defaults from the next code."
        confirmLabel="Reset to defaults"
        destructive
        busy={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
    </>
  );
}
