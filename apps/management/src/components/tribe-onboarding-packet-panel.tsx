"use client";

import { ClipboardIcon } from "lucide-react";
import { toast } from "sonner";
import { getApiCenterBaseUrl } from "@/lib/api-center-client";
import { copyTextToClipboard } from "@/lib/client-clipboard";
import { getTribeOnboardingPacket } from "@/lib/service-onboarding";
import type { ServiceRegistryEntry } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function TribeOnboardingPacketPanel({
  service,
}: {
  service: ServiceRegistryEntry;
}) {
  const packet = getTribeOnboardingPacket(service);
  const portalPacket = getPortalPacketAdditions(service);

  async function copyPacket() {
    const copied = await copyTextToClipboard(
      formatPacket(packet, portalPacket),
    );
    if (copied) {
      toast.success("Onboarding packet copied");
      return;
    }

    toast.error("Copy was blocked", {
      description: "Select the packet sections manually and copy them.",
    });
  }

  async function copySection(title: string, value: string) {
    const copied = await copyTextToClipboard(value);
    if (copied) {
      toast.success(`${title} copied`);
      return;
    }

    toast.error("Copy was blocked", {
      description: "Select the section manually and copy it.",
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Tribe handoff packet</CardTitle>
          <CardDescription>
            Platform tasks, tribe tasks, NestJS setup, service calls, and event
            publishing.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" onClick={copyPacket}>
          <ClipboardIcon data-icon="inline-start" />
          Copy packet
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <TaskList
            title="Platform does"
            items={packet.platformActions}
            onCopy={() =>
              copySection(
                "Platform does",
                formatTaskList(packet.platformActions),
              )
            }
          />
          <TaskList
            title="Tribe does"
            items={packet.tribeActions}
            onCopy={() =>
              copySection("Tribe does", formatTaskList(packet.tribeActions))
            }
          />
        </div>

        <Snippet
          title="Server env vars"
          value={packet.env}
          onCopy={() => copySection("Server env vars", packet.env)}
        />
        <div className="min-w-0 rounded-lg border bg-muted/25 p-3 text-sm">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0 font-medium">Developer portal packet</div>
            <CopySectionButton
              label="Copy developer portal packet"
              onClick={() =>
                copySection(
                  "Developer portal packet",
                  formatTaskList(portalPacket),
                )
              }
            />
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {portalPacket.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <Snippet
          title="NestJS module"
          value={packet.nestjsModule}
          onCopy={() => copySection("NestJS module", packet.nestjsModule)}
        />

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {packet.sharedServiceExamples.map((example) => (
            <Snippet
              key={example.serviceId}
              title={`Call ${example.serviceId}`}
              value={example.call}
              onCopy={() =>
                copySection(`Call ${example.serviceId}`, example.call)
              }
            />
          ))}
          <Snippet
            title="Event publishing integration"
            value={packet.eventPublishing}
            onCopy={() =>
              copySection("Event publishing integration", packet.eventPublishing)
            }
          />
          <Snippet
            title="Custom event integration"
            value={packet.customEventPublishing}
            onCopy={() =>
              copySection("Custom event integration", packet.customEventPublishing)
            }
          />
        </div>

        <div className="min-w-0 rounded-lg border bg-muted/25 p-3 text-sm">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0 font-medium">S3 export topic</div>
            <CopySectionButton
              label="Copy S3 export topic"
              onClick={() =>
                copySection("S3 export topic", packet.topics.primary)
              }
            />
          </div>
          <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {packet.topics.primary}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TaskList({
  title,
  items,
  onCopy,
}: {
  title: string;
  items: string[];
  onCopy: () => void;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 font-medium">{title}</div>
        <CopySectionButton label={`Copy ${title}`} onClick={onCopy} />
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Snippet({
  title,
  value,
  onCopy,
}: {
  title: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 text-sm font-medium">{title}</div>
        <CopySectionButton label={`Copy ${title}`} onClick={onCopy} />
      </div>
      <pre className="max-w-full overflow-x-auto rounded-lg border border-white/10 bg-[var(--surface-code)] p-3 text-xs text-white">
        <code>{value}</code>
      </pre>
    </div>
  );
}

function CopySectionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <ClipboardIcon data-icon="inline-start" />
    </Button>
  );
}

function formatTaskList(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function getPortalPacketAdditions(service: ServiceRegistryEntry) {
  const tribeId = service.ownerTribeId ?? service.serviceId;
  return [
    "Install SDK: npm install @alpha-explora/apicenter-sdk",
    `API Center base URL: ${getApiCenterBaseUrl()}`,
    `Allowed services: ${formatList(service.consumes)}`,
    `Required scopes: ${formatList(service.requiredScopes)}`,
    "Quota policy: review the active tribe quota in Management before go-live",
    `Event topic: tribe.${tribeId}.events`,
    `Support contact: ${service.contact ?? "APICenter platform support"}`,
  ];
}

function formatList(items: string[]) {
  return items.length ? items.join(", ") : "none configured";
}

function formatPacket(
  packet: ReturnType<typeof getTribeOnboardingPacket>,
  portalPacket: string[],
) {
  const sections = [
    ["Platform does", formatTaskList(packet.platformActions)],
    ["Tribe does", formatTaskList(packet.tribeActions)],
    ["Server env vars", packet.env],
    ["Developer portal packet", formatTaskList(portalPacket)],
    ["NestJS module", packet.nestjsModule],
    ...packet.sharedServiceExamples.map((example) => [
      `Call ${example.serviceId}`,
      example.call,
    ]),
    ["Event publishing integration", packet.eventPublishing],
    ["Custom event integration", packet.customEventPublishing],
    ["S3 export topic", packet.topics.primary],
  ];

  return sections.map(([title, body]) => `## ${title}\n\n${body}`).join("\n\n");
}
