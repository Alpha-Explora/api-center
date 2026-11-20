"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { quotas } from "../../data/quotas";
import {
  policyToForm,
  quotaPolicyChange,
  quotaPolicyName,
  tightensLivePolicy,
  type QuotaPolicyChange,
} from "../../model/quota-edit";
import type {
  QuotaForm,
  QuotaFormErrors,
  QuotaPolicy,
} from "../../model/quotas";
import { QuotaPolicyFields } from "./quota-parts";

/** A policy row's actions: edit, enable or disable, delete. */
export function QuotaPolicyMenu({
  policy,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  policy: QuotaPolicy;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Actions for ${quotaPolicyName(policy)}`}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleStatus}>
          {policy.status === "active" ? "Disable" : "Enable"}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Changes a policy's limit, window, mode or capability in place; requests already counted this window still count. */
export function EditQuotaPolicySheet({
  organizationId,
  policy,
  onOpenChange,
  onSaved,
}: {
  organizationId: string;
  policy: QuotaPolicy | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Sheet open={policy !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        {policy ? (
          <EditForm
            key={policy.id}
            organizationId={organizationId}
            policy={policy}
            onDone={(saved) => {
              onOpenChange(false);
              if (saved) onSaved();
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function EditForm({
  organizationId,
  policy,
  onDone,
}: {
  organizationId: string;
  policy: QuotaPolicy;
  onDone: (saved: boolean) => void;
}) {
  const [form, setForm] = useState<QuotaForm>(() => policyToForm(policy));
  const [errors, setErrors] = useState<QuotaFormErrors>({});
  const [confirming, setConfirming] = useState<QuotaPolicyChange | null>(null);
  const save = useMutation({
    mutationFn: (change: QuotaPolicyChange) =>
      quotas.update(organizationId, policy.id, change),
    onSuccess: (updated) => {
      toast.success(`Saved ${quotaPolicyName(updated)}`);
      onDone(true);
    },
  });
  const scope = policy.scope === "shared" ? "shared ceiling" : "project policy";

  return (
    <>
      <form
        className="flex h-full flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          const result = quotaPolicyChange(policy, form);
          setErrors(result.kind === "invalid" ? result.errors : {});
          if (result.kind === "invalid") return;
          if (result.kind === "unchanged") return onDone(false);
          if (tightensLivePolicy(policy, result.change))
            setConfirming(result.change);
          else save.mutate(result.change);
        }}
      >
        <SheetHeader>
          <SheetTitle>
            Edit {policy.environmentKind} {scope}
          </SheetTitle>
          <SheetDescription>
            Now {quotaPolicyName(policy)}. Changes apply from the next request.
            Requests already counted in the current window still count against
            the new limit; a new window length starts from that length&apos;s
            current window.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4">
          {policy.status !== "active" ? (
            <Notice>
              This policy is disabled. Saving keeps it disabled; enable it from
              its menu.
            </Notice>
          ) : null}
          <QuotaPolicyFields
            form={form}
            onChange={setForm}
            errors={errors}
            idPrefix={`edit-quota-${policy.id}`}
          />
          {save.error ? (
            <ErrorPanel title="The policy was not saved" error={save.error} />
          ) : null}
        </div>
        <SheetFooter className="mt-auto flex-row justify-end border-t">
          <Button type="button" variant="outline" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </SheetFooter>
      </form>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => !next && setConfirming(null)}
        title={`Tighten ${quotaPolicyName(policy)} in live`}
        description="Live requests over the new limit are refused with 429 QUOTA_EXCEEDED from the next request. Use observe mode to measure first."
        confirmLabel="Save and enforce"
        busy={save.isPending}
        onConfirm={() => {
          if (confirming) save.mutate(confirming);
          setConfirming(null);
        }}
      />
    </>
  );
}

/** Deleting stops the limit at once and removes it from every list; the audit log keeps its history. */
export function DeleteQuotaPolicyDialog({
  organizationId,
  policy,
  onOpenChange,
  onDeleted,
}: {
  organizationId: string;
  policy: QuotaPolicy | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: (target: QuotaPolicy) =>
      quotas.remove(organizationId, target.id),
    onSuccess: (_, target) => {
      toast.success(`Deleted ${quotaPolicyName(target)}`);
      onOpenChange(false);
      onDeleted();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <ConfirmDialog
      open={policy !== null}
      onOpenChange={(next) => {
        if (!next) remove.reset();
        onOpenChange(next);
      }}
      title={
        policy
          ? `Delete ${quotaPolicyName(policy)} in ${policy.environmentKind}`
          : ""
      }
      description={
        policy?.scope === "shared"
          ? "The ceiling stops limiting every project it covers from the next request, and it can't be restored. The audit log keeps its history."
          : "The limit stops applying from the next request, and it can't be restored. The audit log keeps its history. To pause it instead, disable it."
      }
      confirmLabel="Delete policy"
      destructive
      busy={remove.isPending}
      onConfirm={() => policy && remove.mutate(policy)}
    />
  );
}
