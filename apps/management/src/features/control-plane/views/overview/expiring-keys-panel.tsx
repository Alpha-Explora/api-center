"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorPanel } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { projectHref } from "@/lib/app-navigation";
import { formatDateTime } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { EXPIRY_WARNING_DAYS, keysNeedingReplacement } from "../../model/environment-inventory";
import { ExpiryBadge } from "../applications/expiry-badge";
import { useEnvironmentCredentials } from "../../view-models/environment-inventory";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";

/** Active keys of any application that have expired or expire soon. Shown only when there are some. */
export function ExpiringKeysPanel() {
  const { organizationId, project, kind } = useProjectEnvironment();
  const credentials = useEnvironmentCredentials({ organizationId, projectId: project.id, kind });
  const applications = useQuery({
    queryKey: cpKeys.applications(organizationId, project.id, kind),
    queryFn: () => controlPlane.applications(organizationId, project.id, kind),
    retry: false,
  });

  if (credentials.error) {
    return (
      <Panel title="Expiring keys">
        <ErrorPanel title="Key expiry could not be checked" error={credentials.error} />
      </Panel>
    );
  }
  const expiring = keysNeedingReplacement(credentials.data ?? []);
  if (expiring.length === 0) return null;
  const names = new Map((applications.data ?? []).map((application) => [application.id, application.name]));

  return (
    <Panel
      title="Expiring keys"
      description={`Active keys that have expired or expire within ${EXPIRY_WARNING_DAYS} days. Issue a replacement before revoking.`}
      flush
    >
      <ul className="divide-y">
        {expiring.map((credential) => (
          <li key={credential.id}>
            <Link
              href={projectHref(project.id, kind, `/applications/${encodeURIComponent(credential.applicationId)}?tab=keys`)}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] transition-colors hover:bg-muted/40"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{names.get(credential.applicationId) ?? credential.applicationId}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground" title={formatDateTime(credential.expiresAt)}>
                  {credential.lookupPrefix}…
                </span>
              </span>
              <ExpiryBadge credential={credential} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
