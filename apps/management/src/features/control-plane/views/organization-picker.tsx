"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function OrganizationPicker({
  organizationId,
  organizations,
  onChange,
}: {
  organizationId: string | undefined;
  organizations: string[];
  onChange: (organizationId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  if (organizations.length > 1) {
    return (
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Organization</span>
        <select
          className="h-9 rounded-md border bg-background px-2 font-mono text-xs"
          value={organizationId ?? ""}
          onChange={(event) => onChange(event.target.value)}
        >
          {organizations.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (organizations.length === 1) return null;
  // Platform operators may have no memberships; they name the organization to act on.
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) onChange(draft.trim());
      }}
    >
      <Input
        aria-label="Organization ID"
        className="h-9 w-80 font-mono text-xs"
        placeholder="Organization ID"
        value={draft || organizationId || ""}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button size="sm" type="submit" variant="outline">
        Use
      </Button>
    </form>
  );
}
