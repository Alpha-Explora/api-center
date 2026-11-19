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
import { capabilityConfiguration } from "../../data/capability-configuration";
import { environmentWriteReason } from "../../model/access";
import { fieldErrors } from "../../model/form-errors";
import { smsSenderBody, smsSenderFormSchema, smsSenderSummary, type SmsSender, type SmsSenderForm } from "../../model/sms-sender";
import { configurationKey } from "../../view-models/configuration-key";
import { useProjectEnvironment } from "../../view-models/project-environment";

/** The environment's pinned SMS sender ID, from the SMS runtime, and the form to pin or clear it. */
export function SmsSenderSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const settings = useQuery({
    queryKey: configurationKey(organizationId, project.id, kind, "sms"),
    queryFn: () => capabilityConfiguration.smsSender({ organizationId, projectId: project.id, kind }),
    enabled: open,
    retry: false,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>SMS sender</SheetTitle>
          <SheetDescription>
            The sender ID every SMS from {project.name} in {kind} shows. Once pinned, send requests that name a different senderId are refused.
          </SheetDescription>
        </SheetHeader>
        {settings.error ? (
          <div className="px-4">
            <ErrorPanel title="SMS sender settings could not be loaded" error={settings.error} />
          </div>
        ) : !settings.data ? (
          <div className="flex flex-col gap-3 px-4" aria-busy="true">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <SmsSenderForm key={settings.dataUpdatedAt} current={settings.data} onDone={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SmsSenderForm({ current, onDone }: { current: SmsSender; onDone: () => void }) {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const client = useQueryClient();
  const scope = { organizationId, projectId: project.id, kind };
  const [form, setForm] = useState<SmsSenderForm>({ senderId: current.senderId ?? "" });
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState<"save" | "clear" | null>(null);
  const finish = (message: string) => {
    toast.success(message);
    void client.invalidateQueries({ queryKey: configurationKey(organizationId, project.id, kind, "sms") });
    onDone();
  };
  const save = useMutation({
    mutationFn: () => capabilityConfiguration.saveSmsSender(scope, smsSenderBody(form)),
    onSettled: () => setConfirm(null),
    onSuccess: (sender) => finish(`SMS in ${kind} now sends as ${sender.senderId}`),
  });
  const clear = useMutation({
    mutationFn: () => capabilityConfiguration.clearSmsSender(scope),
    onSettled: () => setConfirm(null),
    onSuccess: () => finish(`SMS in ${kind} uses the platform sender again`),
  });
  const parsed = smsSenderFormSchema.safeParse(form);
  const errors = submitted ? fieldErrors(parsed.error) : {};
  const summary = smsSenderSummary(current);

  return (
    <>
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
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <section className="rounded-lg border p-3">
            <DescriptionList
              items={[
                { label: "Sender", value: <StatusBadge tone={summary.tone}>{summary.label}</StatusBadge> },
                {
                  label: "Requests",
                  value: current.senderId ? `Must omit senderId or send ${current.senderId}` : "May choose their own senderId",
                },
              ]}
            />
          </section>
          {!current.senderId && !current.platformSenderConfigured ? (
            <Notice tone="warning" title="SMS has no sender">
              The platform has no default Twilio sender, so sends fail unless each request names a senderId. Pin one here.
            </Notice>
          ) : null}

          {canWrite ? (
            <>
              <FormRow
                label="Sender ID"
                htmlFor="sms-sender"
                error={errors.senderId}
                hint="A Twilio number in E.164 form (+639171234567), or an alphanumeric sender name of up to 11 characters your Twilio account may use."
              >
                <Input
                  id="sms-sender"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={16}
                  placeholder="+639171234567 or YourBrand"
                  value={form.senderId}
                  aria-invalid={Boolean(errors.senderId)}
                  onChange={(event) => setForm({ senderId: event.target.value })}
                />
              </FormRow>
              {save.error ? <ErrorPanel title="The sender was not saved" error={save.error} /> : null}
              {current.senderId ? (
                <section className="mt-2 flex flex-col gap-2 border-t pt-4">
                  <p className="text-[13px] font-medium">Unpin the sender</p>
                  <p className="text-xs text-muted-foreground">
                    SMS goes back to the platform sender, and requests may again name their own senderId.
                  </p>
                  {clear.error ? <ErrorPanel title="The sender was not unpinned" error={clear.error} /> : null}
                  <div>
                    <Button type="button" size="sm" variant="outline" onClick={() => setConfirm("clear")}>
                      Use platform sender…
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
              {save.isPending ? "Saving…" : "Pin sender"}
            </Button>
          ) : null}
        </SheetFooter>
      </form>
      <ConfirmDialog
        open={confirm === "save"}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={`Pin the live SMS sender for ${project.name}`}
        description={
          parsed.success ? `Live SMS will be sent as ${parsed.data.senderId} from the next send, and requests naming another sender are refused.` : undefined
        }
        confirmLabel="Pin sender"
        busy={save.isPending}
        onConfirm={() => save.mutate()}
      />
      <ConfirmDialog
        open={confirm === "clear"}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={`Unpin the ${kind} SMS sender for ${project.name}`}
        description={`SMS stops sending as ${current.senderId ?? "the pinned sender"} and uses the platform sender, or the sender each request names.`}
        confirmLabel="Use platform sender"
        destructive
        busy={clear.isPending}
        onConfirm={() => clear.mutate()}
      />
    </>
  );
}
