"use client";

import { useState } from "react";
import { DatabaseIcon, LoaderCircleIcon, PlayIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import {
  previewRawToSilverRun,
  startRawToSilverRun,
} from "@/lib/api-center-client";
import type {
  PipelineHealthEnvironment,
  PipelinePartitionDate,
  RawToSilverRunResult,
} from "@/lib/schemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RawToSilverRunPanel({
  environment,
  partition,
}: {
  environment: PipelineHealthEnvironment;
  partition: PipelinePartitionDate;
}) {
  const [tribeId, setTribeId] = useState("");
  const [materialize, setMaterialize] = useState(true);
  const [pendingAction, setPendingAction] = useState<"preview" | "start">();
  const [result, setResult] = useState<RawToSilverRunResult>();
  const [previewPayloadKey, setPreviewPayloadKey] = useState("");
  const trimmedTribeId = tribeId.trim();
  const canSubmit = Boolean(trimmedTribeId) && !pendingAction;
  const currentPayloadKey = [
    environment,
    trimmedTribeId,
    partition.year,
    partition.month,
    partition.day,
    materialize ? "materialize" : "validate",
  ].join(":");
  const canStart =
    canSubmit &&
    result?.status === "preview" &&
    previewPayloadKey === currentPayloadKey;

  async function run(action: "preview" | "start") {
    setPendingAction(action);
    try {
      const payload = {
        environment,
        tribeId: trimmedTribeId,
        year: partition.year,
        month: partition.month,
        day: partition.day,
        materialize,
        preview: action === "preview",
      };
      const nextResult =
        action === "preview"
          ? await previewRawToSilverRun(payload)
          : await startRawToSilverRun(payload);
      setResult(nextResult);
      setPreviewPayloadKey(action === "preview" ? currentPayloadKey : "");
      toast.success(
        action === "preview" ? "Raw to Silver preview ready" : "Raw to Silver run completed",
        {
          description: nextResult.physicalTopic,
        },
      );
    } catch (error) {
      toast.error("Raw to Silver run failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(undefined);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Raw to Silver run</CardTitle>
        <CardDescription>
          Validate a tribe topic from Raw through Bronze and Common Silver, then
          optionally write a tribe-scoped Common Silver snapshot.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-64 flex-col gap-2">
            <Label htmlFor="raw-to-silver-tribe">Tribe ID</Label>
            <Input
              id="raw-to-silver-tribe"
              aria-label="Tribe ID"
              value={tribeId}
              onChange={(event) => {
                setTribeId(event.target.value);
                setPreviewPayloadKey("");
              }}
              placeholder="greenovate"
            />
          </div>
          <label className="flex h-8 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={materialize}
              onChange={(event) => {
                setMaterialize(event.target.checked);
                setPreviewPayloadKey("");
              }}
            />
            Materialize snapshot
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={!canSubmit}
            onClick={() => run("preview")}
          >
            {pendingAction === "preview" ? (
              <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
            ) : (
              <SearchIcon data-icon="inline-start" />
            )}
            Preview Raw to Silver
          </Button>
          <Button
            type="button"
            disabled={!canStart}
            onClick={() => run("start")}
          >
            {pendingAction === "start" ? (
              <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            Start Raw to Silver
          </Button>
        </div>

        <Alert>
          <DatabaseIcon data-icon="inline-start" />
          <AlertTitle>
            {environment.toUpperCase()} partition {partition.year}-{partition.month}-
            {partition.day}
          </AlertTitle>
          <AlertDescription>
            Runs are bounded to one tribe topic and one partition. Raw S3 remains
            the replay source; tribes should consume the Common Silver result.
          </AlertDescription>
        </Alert>

        {!canStart ? (
          <Alert>
            <AlertTitle>Preview required</AlertTitle>
            <AlertDescription>
              Preview the exact tribe, partition, and materialization choice before
              starting the Raw to Silver run.
            </AlertDescription>
          </Alert>
        ) : null}

        {result ? <RunResult result={result} /> : null}
      </CardContent>
    </Card>
  );
}

function RunResult({ result }: { result: RawToSilverRunResult }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={result.status === "blocked" ? "destructive" : "secondary"}>
          {result.status}
        </Badge>
        <span className="font-mono text-sm">{result.physicalTopic}</span>
      </div>
      {result.blockedReason ? (
        <Alert variant="destructive">
          <AlertTitle>Run blocked</AlertTitle>
          <AlertDescription>{result.blockedReason}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2 md:grid-cols-3">
        <StageMetric label="Raw rows" value={result.raw.rowCount} />
        <StageMetric label="Bronze rows" value={result.bronze.rowCount} />
        <StageMetric
          label="Common Silver rows"
          value={result.commonSilver.rowCount}
        />
      </div>
      {result.materialization?.requested ? (
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Materialized output</span>
          <span className="break-all font-mono text-xs text-muted-foreground">
            {result.materialization.externalLocation}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function StageMetric({
  label,
  value,
}: {
  label: string;
  value: number | undefined;
}) {
  return (
    <div className="flex min-h-20 flex-col justify-between rounded-lg border p-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold">{value ?? "Preview"}</span>
    </div>
  );
}
