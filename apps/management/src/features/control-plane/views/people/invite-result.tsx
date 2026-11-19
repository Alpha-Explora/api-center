"use client";
import { CheckCircle2Icon } from "lucide-react";
import { CopyButton } from "@/components/patterns/copy-button";
import { Notice } from "@/components/patterns/notices";
import { inviteFailureText, type Invite } from "../../model/organizations";

/** Whether a new member's invite email went out; when it did not, the same invite to copy and send yourself. */
export function InviteResult({ email, invite }: { email: string; invite: Invite }) {
  if (invite.status === "sent") {
    return (
      <div role="status" className="flex gap-3 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-[13px]">
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">Invite sent</p>
          <p className="mt-0.5 break-words text-muted-foreground">
            {email} was emailed a link to <span className="font-mono text-xs">{invite.consoleUrl}</span>.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warning" title="The invite email was not sent">
        {inviteFailureText(invite)} They were still added; send them the invite yourself.
      </Notice>
      <div className="rounded-lg border bg-muted/40">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
          <span className="text-xs font-medium">Invite for {email}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Copy invite link
            <CopyButton value={invite.consoleUrl} label="Copy invite link" />
          </span>
        </div>
        <pre className="max-h-48 overflow-auto px-3 py-2 font-sans text-[13px] whitespace-pre-wrap text-muted-foreground">{invite.text}</pre>
        <div className="flex justify-end border-t px-3 py-1.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Copy message
            <CopyButton value={invite.text} label="Copy invite message" />
          </span>
        </div>
      </div>
    </div>
  );
}
