import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getManifestDiff } from "@/lib/manifest-diff";
import type { ServiceManifest, ServiceRegistryEntry } from "@/lib/schemas";

export type ManifestDiffPanelProps = {
  current?: ServiceRegistryEntry;
  next: ServiceManifest;
};

export function ManifestDiffPanel({ current, next }: ManifestDiffPanelProps) {
  const diffs = current ? getManifestDiff(current, next) : [];

  if (!diffs.length) {
    return (
      <Alert>
        <AlertTitle>No manifest changes</AlertTitle>
        <AlertDescription>
          Change a field to preview the registry update before submitting.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manifest diff</CardTitle>
        <CardDescription>
          Review changed fields before updating API Center.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {diffs.map((diff) => (
          <div
            key={diff.field}
            className="grid gap-3 rounded-lg border p-3 text-sm md:grid-cols-[10rem_1fr_1fr]"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{diff.field}</span>
              {diff.warning ? (
                <Badge variant="destructive">review</Badge>
              ) : null}
            </div>
            <div>
              <div className="text-muted-foreground">Before</div>
              <div className="break-words">{diff.before}</div>
            </div>
            <div>
              <div className="text-muted-foreground">After</div>
              <div className="break-words">{diff.after}</div>
            </div>
            {diff.warning ? (
              <Alert variant="destructive" className="md:col-span-3">
                <AlertTitle>Risk warning</AlertTitle>
                <AlertDescription>{diff.warning}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
