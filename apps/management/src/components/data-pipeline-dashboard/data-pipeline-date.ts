import type { PipelinePartitionDate } from "@/lib/schemas";

export function currentUtcDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentUtcPartition(): PipelinePartitionDate {
  const value = currentUtcDateInput();
  return {
    year: value.slice(0, 4),
    month: value.slice(5, 7),
    day: value.slice(8, 10),
  };
}

export function dateInputToPartition(
  value: string,
): PipelinePartitionDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return {
    year: match[1],
    month: match[2],
    day: match[3],
  };
}
