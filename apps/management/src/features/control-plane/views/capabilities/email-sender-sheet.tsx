"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormRow } from "@/components/patterns/form";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { formatNumber } from "@/lib/format";
import { capabilityConfiguration } from "../../data/capability-configuration";
import { emailSenderBody, emailSenderFormSchema, type EmailSenderForm } from "../../model/capability-configuration";
import { fieldErrors } from "../../model/form-errors";
import { useProjectEnvironment } from "../../view-models/project-environment";

const EMPTY: EmailSenderForm = { fromAddress: "", dailyLimit: "" };

/** Sets the environment's email sender. The runtime accepts writes only, so the form always starts empty. */
export function EmailSenderSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const [form, setForm] = useState<EmailSenderForm>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const save = useMutation({
    mutationFn: () => capabilityConfiguration.saveEmailSender({ organizationId, projectId: project.id, kind }, emailSenderBody(form)),
    onSettled: () => setConfirming(false),
    onSuccess: (sender) => {
      toast.success(
        `Email in ${kind} now sends from ${sender.fromAddress}${sender.dailyLimit === null ? "" : `, up to ${formatNumber(sender.dailyLimit)} a day`}`,
      );
      close(false);
    },
  });
  const parsed = emailSenderFormSchema.safeParse(form);
  const errors = submitted ? fieldErrors(parsed.error) : {};

  function close(next: boolean) {
    if (!next) {
      setForm(EMPTY);
      setSubmitted(false);
      save.reset();
    }
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="sm:max-w-md">
        <form
          noValidate
          className="flex h-full flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            if (!parsed.success) return;
            // Live sends real mail; replacing its sender is confirmed.
            if (kind === "live") setConfirming(true);
            else save.mutate();
          }}
        >
          <SheetHeader>
            <SheetTitle>Email sender</SheetTitle>
            <SheetDescription>
              The address every email from {project.name} in {kind} is sent from. Send requests that name a different from address are refused.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <Notice tone="warning" title="The current sender can't be shown">
              The email service accepts new settings but does not return the saved ones. Saving replaces whatever is set now, including the daily limit.
            </Notice>
            <FormRow label="From address" htmlFor="email-from" error={errors.fromAddress} hint="For example no-reply@yourcompany.com.">
              <Input
                id="email-from"
                autoFocus
                autoComplete="off"
                maxLength={320}
                placeholder="no-reply@yourcompany.com"
                value={form.fromAddress}
                aria-invalid={Boolean(errors.fromAddress)}
                onChange={(event) => setForm({ ...form, fromAddress: event.target.value })}
              />
            </FormRow>
            <FormRow label="Daily limit" htmlFor="email-limit" error={errors.dailyLimit} hint="Emails per day. Leave empty for no limit.">
              <Input
                id="email-limit"
                inputMode="numeric"
                placeholder="Unlimited"
                value={form.dailyLimit}
                aria-invalid={Boolean(errors.dailyLimit)}
                onChange={(event) => setForm({ ...form, dailyLimit: event.target.value })}
              />
            </FormRow>
            {save.error ? <ErrorPanel title="The sender was not saved" error={save.error} /> : null}
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Replace sender"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Replace the live email sender for ${project.name}`}
        description={parsed.success ? `Live email will be sent from ${parsed.data.fromAddress} from the next send.` : undefined}
        confirmLabel="Replace sender"
        busy={save.isPending}
        onConfirm={() => save.mutate()}
      />
    </Sheet>
  );
}
