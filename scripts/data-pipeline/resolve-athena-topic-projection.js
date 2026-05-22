#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const TOPIC_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

function parseArgs(argv) {
  const topics = [];
  const expectedTopics = [];
  let topicsFile = null;
  let rawTopicTablesSqlFile = null;
  let onboardingStateFile = null;
  let confluentTopicsFile = null;
  let check = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '-TopicsFile' || arg === '--topics-file') {
      topicsFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '-Topic' || arg === '--topic') {
      topics.push(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === '-ExpectedTopic' || arg === '--expected-topic') {
      expectedTopics.push(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === '-RawTopicTablesSql' || arg === '--raw-topic-tables-sql') {
      rawTopicTablesSqlFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '-OnboardingStateFile' || arg === '--onboarding-state-file') {
      onboardingStateFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '-ConfluentTopicsFile' || arg === '--confluent-topics-file') {
      confluentTopicsFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '-Check' || arg === '--check') {
      check = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      return { help: true, topics, topicsFile, expectedTopics, check };
    }

    topics.push(arg);
  }

  return {
    help: false,
    topics,
    topicsFile,
    expectedTopics,
    rawTopicTablesSqlFile,
    onboardingStateFile,
    confluentTopicsFile,
    check,
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/data-pipeline/resolve-athena-topic-projection.js -TopicsFile infra/aws-data-pipeline/topic-projection-values.txt
  node scripts/data-pipeline/resolve-athena-topic-projection.js -Topic test.tribe.logistics.events -Topic test.api-center.gateway.request
  node scripts/data-pipeline/resolve-athena-topic-projection.js --check -TopicsFile infra/aws-data-pipeline/topic-projection-values.txt -RawTopicTablesSql infra/aws-data-pipeline/catalog/raw-topic-tables.sql
`);
}

function readTopicsFile(topicsFile) {
  const resolved = path.resolve(process.cwd(), topicsFile);
  const content = fs.readFileSync(resolved, 'utf8');

  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}

function readOptionalTopicsFile(topicsFile) {
  if (!topicsFile) {
    return [];
  }

  return readTopicsFile(topicsFile);
}

function normalizeTopics(rawTopics) {
  const invalid = [];
  const topics = new Set();

  for (const rawTopic of rawTopics) {
    const topic = String(rawTopic ?? '').trim();
    if (!topic) {
      continue;
    }

    if (!TOPIC_PATTERN.test(topic) || topic.includes('..')) {
      invalid.push(topic);
      continue;
    }

    topics.add(topic);
  }

  if (invalid.length > 0) {
    throw new Error(`Invalid topic name(s): ${invalid.join(', ')}`);
  }

  return [...topics].sort((left, right) => left.localeCompare(right));
}

function isSortedUnique(rawTopics) {
  const normalized = normalizeTopics(rawTopics);
  return rawTopics.length === normalized.length && rawTopics.every((topic, index) => topic === normalized[index]);
}

function extractProjectionEnums(rawSql) {
  const matches = [];
  const pattern = /['"]projection\.physical_topic\.values['"]\s*=\s*['"]([^'"]*)['"]/g;
  let match = pattern.exec(rawSql);

  while (match) {
    matches.push(match[1]);
    match = pattern.exec(rawSql);
  }

  return matches;
}

function collectOnboardingPhysicalTopics(value) {
  const topics = [];

  function visit(current) {
    if (!current || typeof current !== 'object') {
      return;
    }

    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    const record = current;
    const topic = record.physical_topic ?? record.physicalTopic;
    if (typeof topic === 'string' && topic.trim()) {
      topics.push(topic.trim());
    }

    for (const nested of Object.values(record)) {
      if (nested && typeof nested === 'object') {
        visit(nested);
      }
    }
  }

  visit(value);
  return [...new Set(topics)].sort((left, right) => left.localeCompare(right));
}

function resolveProjection({ topicsFile, topics }) {
  const rawTopics = [...topics];

  if (topicsFile) {
    rawTopics.push(...readTopicsFile(topicsFile));
  }

  const normalized = normalizeTopics(rawTopics);
  if (normalized.length === 0) {
    throw new Error('At least one topic must be provided.');
  }

  return normalized.join(',');
}

function checkProjectionDrift({
  topicsFile,
  expectedTopics = [],
  rawTopicTablesSqlFile,
  onboardingStateFile,
  confluentTopics = [],
}) {
  const errors = [];
  const warnings = [];
  const fileTopics = readTopicsFile(topicsFile);
  const projectionTopics = normalizeTopics(fileTopics);
  const projectionTopicSet = new Set(projectionTopics);
  const generatedProjection = projectionTopics.join(',');

  if (!isSortedUnique(fileTopics)) {
    errors.push('Projection values file is not sorted and unique.');
  }

  for (const expectedTopic of normalizeTopics(expectedTopics)) {
    if (!projectionTopicSet.has(expectedTopic)) {
      errors.push(`Expected topic is missing from projection values: ${expectedTopic}`);
    }
  }

  if (rawTopicTablesSqlFile) {
    const sql = fs.readFileSync(path.resolve(process.cwd(), rawTopicTablesSqlFile), 'utf8');
    const projectionEnums = extractProjectionEnums(sql);

    if (projectionEnums.length === 0) {
      errors.push('raw-topic-tables.sql does not contain projection.physical_topic.values.');
    }

    for (const projectionEnum of projectionEnums) {
      if (projectionEnum !== generatedProjection) {
        errors.push('raw-topic-tables.sql projection enum does not match generated topic projection values.');
        break;
      }
    }
  }

  if (onboardingStateFile && fs.existsSync(path.resolve(process.cwd(), onboardingStateFile))) {
    const rawState = fs.readFileSync(path.resolve(process.cwd(), onboardingStateFile), 'utf8');
    const onboardingTopics = collectOnboardingPhysicalTopics(JSON.parse(rawState));

    for (const topic of onboardingTopics) {
      if (!projectionTopicSet.has(topic)) {
        errors.push(`Onboarding-state topic is missing from projection values: ${topic}`);
      }
    }
  } else if (onboardingStateFile) {
    warnings.push(`Onboarding state file was not found: ${onboardingStateFile}`);
  }

  const managedConfluentTopics = confluentTopics
    .map((topic) => String(topic ?? '').trim())
    .filter(Boolean)
    .filter(isManagedProjectionTopic);

  for (const topic of normalizeTopics(managedConfluentTopics)) {
    if (isManagedProjectionTopic(topic) && !projectionTopicSet.has(topic)) {
      errors.push(`Confluent-managed topic is missing from projection values: ${topic}`);
    }
  }

  return {
    ok: errors.length === 0,
    topics_file: topicsFile,
    topic_count: projectionTopics.length,
    errors,
    warnings,
  };
}

function isManagedProjectionTopic(topic) {
  return (
    /^(test|prod)\.tribe\.[a-z0-9._-]+\.events$/.test(topic) ||
    /^(test|prod)\.api-center\.shared\.[a-z0-9._-]+\.events$/.test(topic) ||
    /^(test|prod)\.api-center\./.test(topic)
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  try {
    if (options.check) {
      const report = checkProjectionDrift({
        topicsFile: options.topicsFile,
        expectedTopics: options.expectedTopics,
        rawTopicTablesSqlFile: options.rawTopicTablesSqlFile,
        onboardingStateFile: options.onboardingStateFile,
        confluentTopics: readOptionalTopicsFile(options.confluentTopicsFile),
      });

      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) {
        process.exit(1);
      }
      return;
    }

    console.log(resolveProjection(options));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  checkProjectionDrift,
  collectOnboardingPhysicalTopics,
  extractProjectionEnums,
  normalizeTopics,
  resolveProjection,
};
