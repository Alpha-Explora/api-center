"use client";

import { Input } from "@/components/ui/input";

export type RegistryFilters = {
  query: string;
  ownerTeam: string;
  status: string;
  serviceType: string;
};

export const emptyRegistryFilters: RegistryFilters = {
  query: "",
  ownerTeam: "",
  status: "",
  serviceType: "",
};

export function RegistryFiltersPanel({
  value,
  onChange,
}: {
  value: RegistryFilters;
  onChange: (value: RegistryFilters) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <Input
        aria-label="Search registry"
        value={value.query}
        onChange={(event) => onChange({ ...value, query: event.target.value })}
        placeholder="Search service, URL, contact"
      />
      <Input
        aria-label="Filter by owner team"
        value={value.ownerTeam}
        onChange={(event) =>
          onChange({ ...value, ownerTeam: event.target.value })
        }
        placeholder="Owner team"
      />
      <select
        aria-label="Filter by service type"
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        value={value.serviceType}
        onChange={(event) =>
          onChange({ ...value, serviceType: event.target.value })
        }
      >
        <option value="">All types</option>
        <option value="tribe">tribe</option>
        <option value="shared">shared</option>
      </select>
      <select
        aria-label="Filter by service status"
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        value={value.status}
        onChange={(event) => onChange({ ...value, status: event.target.value })}
      >
        <option value="">All statuses</option>
        <option value="active">active</option>
        <option value="deprecated">deprecated</option>
        <option value="retired">retired</option>
      </select>
    </div>
  );
}
