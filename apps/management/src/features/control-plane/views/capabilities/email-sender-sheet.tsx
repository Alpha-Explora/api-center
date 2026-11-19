"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormRow } from "@/components/patterns/form";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { DescriptionList } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatNumber } from "@/lib/format";
import { capabilityConfiguration } from "../../data/capability-configuration";
import { environmentWriteReason } from "../../model/access";
import {
  emailSenderBody,
  emailSenderFormFrom,
  emailSenderFormSchema,
  type EmailSenderForm,
  type EmailSenderSettings,
} from "../../model/capability-configuration";
import { fieldErrors } from "../../model/form-errors";
import { configurationKey } from "../../view-models/configuration-key";
import { useProjectEnvironment } from "../../view-models/project-environment";

/** The environment's email sender: the saved settings from the email runtime, and the form to replace them. */
export function EmailSenderSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const settings = useQuery({
    queryKey: configurationKey(organizationId, project.id, kind, "email"),
    queryFn: () => capabilityConfiguration.emailSender({ organizationId, projectId: project.id, kind }),
    enabled: open,
    retry: false,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Email sender</SheetTitle>
          <SheetDescription>
            The address every email from {project.name} in {kind} is sent from. Send requests that name a different from address are refused.
          </SheetDescription>
        </SheetHeader>
        {settings.isLoading ? (
          <div className="flex flex-col gap-3 px-4" aria-busy="true">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          // Keyed by fetch time so the form restarts from the saved settings after each save.
          <EmailSenderForm key={settings.dataUpdatedAt} current={settings.data} loadError={settings.error} onDone={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function EmailSenderForm({ current, loadError, onDone }: { current: EmailSenderSettings | undefined; loadError: unknown; onDone: () => void }) {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const client = useQueryClient();
  const [form, setForm] = useState<EmailSenderForm>(() => emailSenderFormFrom(current));
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const save = useMutation({
    mutationFn: () => capabilityConfiguration.saveEmailSender({ organizationId, projectId: project.id, kind }, emailSenderBody(form)),
    onSettled: () => setConfirming(false),
    onSuccess: (sender) => {
      toast.success(
        `Email in ${kind} now sends from ${sender.fromAddress}${sender.dailyLimit === null ? "" : `, up to ${formatNumber(sender.dailyLimit)} a day`}`,
      );
      void client.invalidateQueries({ queryKey: configurationKey(organizationId, project.id, kind, "email") });
      onDone();
    },
  });
  const parsed = emailSenderFormSchema.safeParse(form);
  const errors = submitted ? fieldErrors(parsed.error) : {};
  const defaults = current?.defaults ?? null;
  const defaultLimit = defaults ? `${formatNumber(defaults.dailyLimit)} a day (platform default)` : "Platform default";

  return (
    <>
      <form
        noValidate
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (!parsed.success) return;
          // Live sends real mail; replacing its sender is confirmed.
          if (kind === "live") setConfirming(true);
          else save.mutate();
        }}
      >
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {loadError ? (
            <ErrorPanel title="The current sender could not be loaded" error={loadError} />
          ) : current ? (
            <section className="rounded-lg border p-3">
              <DescriptionList
                items={[
                  {
                    label: "Status",
                    value: current.configured ? <StatusBadge tone="success">Configured</StatusBadge> : <StatusBadge tone="neutral">Platform default</StatusBadge>,
                  },
                  {
                    label: "From address",
                    value: current.fromAddress ?? (defaults?.fromAddress ? `${defaults.fromAddress} (platform default)` : "Platform default"),
                  },
                  {
                    label: "Daily limit",
                    value: current.dailyLimit === null ? defaultLimit : `${formatNumber(current.dailyLimit)} a day`,
                  },
                ]}
              />
            </section>
          ) : null}

          {canWrite ? (
            <>
              {loadError ? (
                <Notice tone="warning">You can still save a sender. Saving replaces whatever is set now, including the daily limit.</Notice>
              ) : null}
              <FormRow label="From address" htmlFor="email-from" error={errors.fromAddress} hint="For example no-reply@yourcompany.com.">
                <Input
                  id="email-from"
                  autoComplete="off"
                  maxLength={320}
                  placeholder="no-reply@yourcompany.com"
                  value={form.fromAddress}
                  aria-invalid={Boolean(errors.fromAddress)}
                  onChange={(event) => setForm({ ...form, fromAddress: event.target.value })}
                />
              </FormRow>
              <FormRow
                label="Daily limit"
                htmlFor="email-limit"
                error={errors.dailyLimit}
                hint={`Emails per UTC day. Leave empty for the platform default${defaults ? ` (${formatNumber(defaults.dailyLimit)})` : ""}.`}
              >
                <Input
                  id="email-limit"
                  inputMode="numeric"
                  placeholder={defaults ? formatNumber(defaults.dailyLimit) : "Platform default"}
                  value={form.dailyLimit}
                  aria-invalid={Boolean(errors.dailyLimit)}
                  onChange={(event) => setForm({ ...form, dailyLimit: event.target.value })}
                />
              </FormRow>
              {save.error ? <ErrorPanel title="The sender was not saved" error={save.error} /> : null}
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
              {save.isPending ? "Saving…" : "Save sender"}
            </Button>
          ) : null}
        </SheetFooter>
      </form>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Replace the live email sender for ${project.name}`}
        description={parsed.success ? `Live email will be sent from ${parsed.data.fromAddress} from the next send.` : undefined}
        confirmLabel="Replace sender"
        busy={save.isPending}
        onConfirm={() => save.mutate()}
      />
    </>
  );
}
