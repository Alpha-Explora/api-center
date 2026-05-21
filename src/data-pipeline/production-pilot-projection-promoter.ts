import {
  checkProductionPilotApproval,
  type ProductionPilotApprovalRecord,
} from "./production-pilot-approval-checker";

export interface ProductionPilotProjectionPromotionInput {
  approval: ProductionPilotApprovalRecord;
  topics: string[];
  rawTopicTablesSql: string;
}

export interface ProductionPilotProjectionPromotionResult {
  ok: boolean;
  changed: boolean;
  approvedTopic: string;
  projection: string;
  topics: string[];
  rawTopicTablesSql: string;
  errors: string[];
  warnings: string[];
}

const PROJECTION_PROPERTY_PATTERN =
  /(['"]projection\.physical_topic\.values['"]\s*=\s*['"])([^'"]*)(['"])/g;

const TOPIC_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

export function planProductionPilotProjectionPromotion(
  input: ProductionPilotProjectionPromotionInput,
): ProductionPilotProjectionPromotionResult {
  const approvalResult = checkProductionPilotApproval(input.approval);

  if (!approvalResult.ok) {
    return {
      ok: false,
      changed: false,
      approvedTopic: approvalResult.record.approved_prod_physical_topic,
      projection: normalizeTopics(input.topics).join(","),
      topics: normalizeTopics(input.topics),
      rawTopicTablesSql: input.rawTopicTablesSql,
      errors: approvalResult.errors,
      warnings: approvalResult.warnings,
    };
  }

  const approvedTopic = approvalResult.record.approved_prod_physical_topic;
  const originalTopics = normalizeTopics(input.topics);
  const topics = normalizeTopics([...originalTopics, approvedTopic]);
  const projection = topics.join(",");
  const updatedSql = replaceProjectionValues(
    input.rawTopicTablesSql,
    projection,
  );
  const changed =
    originalTopics.join(",") !== projection ||
    updatedSql !== input.rawTopicTablesSql;

  return {
    ok: true,
    changed,
    approvedTopic,
    projection,
    topics,
    rawTopicTablesSql: updatedSql,
    errors: [],
    warnings: approvalResult.warnings,
  };
}

function normalizeTopics(rawTopics: string[]): string[] {
  const invalid: string[] = [];
  const topics = new Set<string>();

  for (const rawTopic of rawTopics) {
    const topic = String(rawTopic ?? "").trim();
    if (!topic) continue;

    if (!TOPIC_PATTERN.test(topic) || topic.includes("..")) {
      invalid.push(topic);
      continue;
    }

    topics.add(topic);
  }

  if (invalid.length > 0) {
    throw new Error(`Invalid topic name(s): ${invalid.join(", ")}`);
  }

  return [...topics].sort((left, right) => left.localeCompare(right));
}

function replaceProjectionValues(rawSql: string, projection: string): string {
  let replacementCount = 0;
  const updatedSql = rawSql.replace(
    PROJECTION_PROPERTY_PATTERN,
    (_match, prefix: string, _value: string, suffix: string) => {
      replacementCount += 1;
      return `${prefix}${projection}${suffix}`;
    },
  );

  if (replacementCount === 0) {
    throw new Error(
      "raw-topic-tables.sql does not contain projection.physical_topic.values.",
    );
  }

  return updatedSql;
}
