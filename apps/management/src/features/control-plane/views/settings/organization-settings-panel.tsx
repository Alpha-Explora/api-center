"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IdText } from "@/components/patterns/copy-button";
import { DescriptionList, Panel } from "@/components/patterns/panel";
import { organizationsAdmin } from "../../data/organizations";
import { cpKeys } from "../../view-models/query-keys";
import { useAccess, useOrganization } from "../../view-models/use-organization";

/** The current organization: its name (owners rename it), slug and ID, and where its people are managed. */
export function OrganizationSettingsPanel() {
  const { organizationId, organization } = useOrganization();
  const { access } = useAccess(organizationId);
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const rename = useMutation({
    mutationFn: () => organizationsAdmin.renameName(organizationId as string, name.trim()),
    onSuccess: (renamed) => {
      toast.success(`Renamed to ${renamed.name}`);
      setEditing(false);
      void client.invalidateQueries({ queryKey: cpKeys.session });
      void client.invalidateQueries({ queryKey: cpKeys.organizations });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!organizationId || !organization) return null;
  return (
    <Panel
      title="Organization"
      description="The organization you are working in. Switch organizations from the sidebar."
      actions={
        access.canManageOwners && !editing ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setName(organization.name);
              setEditing(true);
            }}
          >
            Rename
          </Button>
        ) : null
      }
    >
      {editing ? (
        <form
          className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && name.trim() !== organization.name) rename.mutate();
          }}
        >
          <Input aria-label="Organization name" autoFocus className="sm:max-w-sm" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={!name.trim() || name.trim() === organization.name || rename.isPending}>
              {rename.isPending ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      <DescriptionList
        items={[
          { label: "Name", value: organization.name },
          ...(organization.slug ? [{ label: "Slug", value: <span className="font-mono text-xs">{organization.slug}</span> }] : []),
          { label: "ID", value: <IdText value={organization.id} /> },
          {
            label: "People",
            value: (
              <Link href="/people" className="hover:underline">
                Members and teams
              </Link>
            ),
          },
        ]}
      />
    </Panel>
  );
}
