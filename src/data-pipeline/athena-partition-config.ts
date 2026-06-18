export type PartitionDate = {
  year?: string;
  month?: string;
  day?: string;
};

export type ResolvePartitionDateInput = {
  partitionDate?: PartitionDate;
  options?: PartitionDate;
  env?: NodeJS.ProcessEnv;
  prefixes: string[];
  now?: Date;
};

export function resolveEnvPartitionDate(
  env: NodeJS.ProcessEnv,
  prefix: string,
): PartitionDate {
  return {
    year: env[`${prefix}_YEAR`],
    month: env[`${prefix}_MONTH`],
    day: env[`${prefix}_DAY`],
  };
}

export function resolvePartitionDate({
  partitionDate,
  options = {},
  env = process.env,
  prefixes,
  now = new Date(),
}: ResolvePartitionDateInput): Required<PartitionDate> {
  if (partitionDate?.year && partitionDate.month && partitionDate.day) {
    return {
      year: partitionDate.year,
      month: partitionDate.month,
      day: partitionDate.day,
    };
  }

  const envDates = prefixes.map((prefix) =>
    resolveEnvPartitionDate(env, prefix),
  );

  return {
    year:
      options.year ??
      firstDefined(envDates.map((date) => date.year)) ??
      String(now.getUTCFullYear()),
    month:
      options.month ??
      firstDefined(envDates.map((date) => date.month)) ??
      String(now.getUTCMonth() + 1).padStart(2, "0"),
    day:
      options.day ??
      firstDefined(envDates.map((date) => date.day)) ??
      String(now.getUTCDate()).padStart(2, "0"),
  };
}

function firstDefined(values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined);
}
