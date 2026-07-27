import type { ServiceRegistryEntry } from "@/lib/schemas";
import {
  getSdkServiceExamples,
  getTribeOnboardingPacket,
} from "@/lib/service-onboarding";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SdkConfigPanel({ service }: { service: ServiceRegistryEntry }) {
  const packet = getTribeOnboardingPacket(service);
  const sdkExamples = getSdkServiceExamples();
  const declaredConsumes = new Set(service.consumes);
  const routeNamespace = service.serviceType === "shared" ? "shared" : "tribes";

  return (
    <Card>
      <CardHeader>
        <CardTitle>SDK onboarding</CardTitle>
        <CardDescription>
          NestJS setup, shared-service calls, event publishing, and contracts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border bg-muted/25 p-3 text-sm">
          <div className="font-medium">SDK package</div>
          <Snippet value="npm install @implementsprint/sdk" />
          <div className="mt-2 text-xs text-muted-foreground">
            Keep this package name until the published SDK name changes.
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SnippetBlock title="Server env vars" value={packet.env} />
          <SnippetBlock title="NestJS provider module" value={packet.nestjsModule} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SnippetBlock
            title="Publish platform event"
            value={packet.eventPublishing}
          />
          <SnippetBlock
            title="Publish custom tribe event"
            value={packet.customEventPublishing}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <div className="font-medium">Shared-service SDK examples</div>
            <div className="text-sm text-muted-foreground">
              These calls go through API Center; tribes should not call provider APIs directly.
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {sdkExamples.map((example) => (
              <div key={example.serviceId} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{example.label}</div>
                    <div className="text-sm text-muted-foreground">
                      {example.summary}
                    </div>
                  </div>
                  {declaredConsumes.has(example.serviceId) ? (
                    <Badge variant="secondary">Declared</Badge>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <ContractItem
                    label="Route"
                    value={`/api/v1/shared/${example.serviceId}${example.path}`}
                  />
                  <ContractItem label="Method" value={example.method} />
                  <ContractItem label="Scope" value={example.scope} />
                  <ContractItem label="Audit/event" value={example.eventOutput} />
                </div>
                <Snippet value={example.call} />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <div className="font-medium">Registered service contract</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Exposed routes for this service as registered in API Center.
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {service.exposes.map((route) => (
              <div
                key={route}
                className="rounded-lg border bg-muted/25 p-3 text-xs"
              >
                <ContractItem
                  label="Route"
                  value={`/api/v1/${routeNamespace}/${service.serviceId}${route}`}
                />
                <ContractItem label="Method" value="Service-defined" />
                <ContractItem
                  label="Required scopes"
                  value={service.requiredScopes.join(", ")}
                />
                <ContractItem label="Payload" value="Service-defined request body" />
                <ContractItem label="Response" value="Service-defined response" />
                <ContractItem
                  label="Audit/event"
                  value={`${service.serviceId}.request`}
                />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SnippetBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">{title}</div>
      <Snippet value={value} />
    </div>
  );
}

function Snippet({ value }: { value: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-[var(--surface-code)] p-3 text-xs text-white">
      <code>{value}</code>
    </pre>
  );
}

function ContractItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-medium text-muted-foreground">{label}</div>
      <div className="break-all font-mono">{value}</div>
    </div>
  );
}
