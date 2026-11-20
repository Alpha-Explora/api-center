import { StatusBadge } from "@/components/patterns/status-badge";

import { expiryState } from "../../model/environment-inventory";
import { RelativeTime } from "@/components/patterns/relative-time";

/** Flags an active key that is expired or expires within the warning window. */
export function ExpiryBadge({ credential }: { credential: { status: string; expiresAt: string } }) {
  const state = expiryState(credential);
  if (state === "current") return null;
  return (
    <StatusBadge tone={state === "expired" ? "danger" : "warning"} className="font-normal">
      {state === "expired" ? (
        "Expired"
      ) : (
        <>
          Expires <RelativeTime value={credential.expiresAt} />
        </>
      )}
    </StatusBadge>
  );
}
