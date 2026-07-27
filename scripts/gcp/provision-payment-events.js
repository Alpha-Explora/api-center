#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { z } = require('zod');

const GCLOUD_COMMAND = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';

const DAY_SECONDS = 31 * 24 * 60 * 60;
const argsSchema = z.object({
  project: z.string().min(1),
  consumerProject: z.string().min(1).optional(),
  region: z.string().min(1),
  environment: z.enum(['test', 'live']),
  consumerServiceId: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  endpoint: z.string().url(),
  cloudRunServiceName: z.string().regex(/^[a-z][a-z0-9-]{0,48}$/),
  deliveryServiceAccount: z.string().email(),
  notificationChannel: z.string().optional(),
  apply: z.boolean().default(false),
});

function parseArgs(argv) {
  const values = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      values.apply = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    values[key] = value;
    index += 1;
  }
  return argsSchema.parse(values);
}

function validateEndpoint(endpoint, environment) {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'https:') throw new Error('Consumer endpoint must use HTTPS.');
  if (!parsed.hostname.endsWith('.run.app')) throw new Error('Consumer endpoint must be a Cloud Run run.app URL.');
  if (parsed.search || parsed.hash) throw new Error('Consumer endpoint must not contain a query or fragment.');
  if (environment === 'test' && /(^|[-.])live([-.]|$)/i.test(parsed.hostname)) {
    throw new Error('Test delivery endpoint cannot be a live Cloud Run hostname.');
  }
  if (environment === 'live' && /(^|[-.])test([-.]|$)/i.test(parsed.hostname)) {
    throw new Error('Live delivery endpoint cannot be a test Cloud Run hostname.');
  }
  return parsed.toString().replace(/\/$/, '');
}

function resourceNames(environment, consumerServiceId) {
  const topic = `apicenter.payment-events.${environment}`;
  return {
    topic,
    deadLetterTopic: `${topic}.dead-letter`,
    deadLetterSubscription: `${topic}.dead-letter.subscription`,
    subscription: `${topic}.${consumerServiceId}`,
    alertPolicy: `${topic}.${consumerServiceId}.delivery-failures`,
  };
}

function buildPlan(input, projectNumber = '${PROJECT_NUMBER}') {
  const endpoint = validateEndpoint(input.endpoint, input.environment);
  const consumerProject = input.consumerProject || input.project;
  const projectDomain = `${input.project}.iam.gserviceaccount.com`;
  if (!input.deliveryServiceAccount.endsWith(`@${projectDomain}`)) {
    throw new Error(`Delivery service account must belong to ${projectDomain}.`);
  }
  const names = resourceNames(input.environment, input.consumerServiceId);
  const pubsubAgent = `service-${projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`;
  const deliveryServiceAccountId = input.deliveryServiceAccount.split('@')[0];
  const member = `serviceAccount:${input.deliveryServiceAccount}`;
  const consumerFilter = `--message-filter=attributes.consumerServiceId=\\"${input.consumerServiceId}\\"`;
  const deadLetterTopicResource = `projects/${input.project}/topics/${names.deadLetterTopic}`;
  const commands = [
    ['iam', 'service-accounts', 'create', deliveryServiceAccountId, `--project=${input.project}`, '--display-name=APICenter-payment-event-delivery'],
    ['pubsub', 'topics', 'create', names.topic, `--project=${input.project}`],
    ['pubsub', 'topics', 'update', names.topic, `--project=${input.project}`, `--message-retention-duration=${DAY_SECONDS}s`],
    ['pubsub', 'topics', 'create', names.deadLetterTopic, `--project=${input.project}`],
    ['pubsub', 'topics', 'update', names.deadLetterTopic, `--project=${input.project}`, `--message-retention-duration=${DAY_SECONDS}s`],
    ['pubsub', 'subscriptions', 'create', names.deadLetterSubscription, `--project=${input.project}`, `--topic=${names.deadLetterTopic}`, '--expiration-period=never', `--message-retention-duration=${DAY_SECONDS}s`],
    ['pubsub', 'subscriptions', 'create', names.subscription, `--project=${input.project}`, `--topic=${names.topic}`, consumerFilter, `--push-endpoint=${endpoint}`, `--push-auth-service-account=${input.deliveryServiceAccount}`, `--push-auth-token-audience=${endpoint}`, `--dead-letter-topic=${deadLetterTopicResource}`, '--max-delivery-attempts=20', '--ack-deadline=30', '--expiration-period=never', `--message-retention-duration=${DAY_SECONDS}s`],
    ['pubsub', 'subscriptions', 'update', names.subscription, `--project=${input.project}`, `--push-endpoint=${endpoint}`, `--push-auth-service-account=${input.deliveryServiceAccount}`, `--push-auth-token-audience=${endpoint}`, `--dead-letter-topic=${deadLetterTopicResource}`, '--max-delivery-attempts=20', '--ack-deadline=30', '--expiration-period=never', `--message-retention-duration=${DAY_SECONDS}s`],
    ['pubsub', 'topics', 'add-iam-policy-binding', names.deadLetterTopic, `--project=${input.project}`, `--member=serviceAccount:${pubsubAgent}`, '--role=roles/pubsub.publisher'],
    ['pubsub', 'subscriptions', 'add-iam-policy-binding', names.subscription, `--project=${input.project}`, `--member=serviceAccount:${pubsubAgent}`, '--role=roles/pubsub.subscriber'],
    ['iam', 'service-accounts', 'add-iam-policy-binding', input.deliveryServiceAccount, `--project=${input.project}`, `--member=serviceAccount:${pubsubAgent}`, '--role=roles/iam.serviceAccountTokenCreator'],
    ['run', 'services', 'add-iam-policy-binding', input.cloudRunServiceName, `--project=${consumerProject}`, `--region=${input.region}`, `--member=${member}`, '--role=roles/run.invoker'],
  ];
  const policy = {
    displayName: names.alertPolicy,
    combiner: 'OR',
    conditions: [{
      displayName: `${names.deadLetterSubscription} has undelivered messages`,
      conditionThreshold: {
        filter: `metric.type="pubsub.googleapis.com/subscription/num_undelivered_messages" resource.type="pubsub_subscription" resource.labels.subscription_id="${names.deadLetterSubscription}"`,
        comparison: 'COMPARISON_GT',
        thresholdValue: 0,
        duration: '300s',
        aggregations: [{ alignmentPeriod: '60s', perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_MAX' }],
      },
    }],
    notificationChannels: input.notificationChannel ? [input.notificationChannel] : [],
    alertStrategy: { autoClose: '604800s' },
    documentation: { content: `APICenter ${input.environment} payment event delivery has dead-letter messages for ${input.consumerServiceId}.`, mimeType: 'text/markdown' },
  };
  return { names, endpoint, commands, policy, projectNumber };
}

function runGcloud(args, { allowAlreadyExists = false } = {}) {
  try {
    return execFileSync(GCLOUD_COMMAND, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' });
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}${error.message || ''}`;
    if (allowAlreadyExists && /already exists|ALREADY_EXISTS|already exists/i.test(output)) return '';
    throw new Error(`gcloud ${args.join(' ')} failed: ${output.trim()}`);
  }
}

function applyPlan(input, plan) {
  for (const command of plan.commands) {
    const isCreate = command[command.indexOf('create')] === 'create';
    runGcloud(command, { allowAlreadyExists: isCreate });
  }
  const directory = mkdtempSync(join(tmpdir(), 'apicenter-payment-alert-'));
  const policyPath = join(directory, 'policy.json');
  writeFileSync(policyPath, `${JSON.stringify(plan.policy, null, 2)}\n`, 'utf8');
  try {
    const existing = runGcloud(['monitoring', 'policies', 'list', `--project=${input.project}`, `--filter=displayName="${plan.names.alertPolicy}"`, '--format=value(name)']).trim();
    runGcloud(existing
      ? ['monitoring', 'policies', 'update', existing, `--project=${input.project}`, `--policy-from-file=${policyPath}`]
      : ['monitoring', 'policies', 'create', `--project=${input.project}`, `--policy-from-file=${policyPath}`]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function main() {
  const input = parseArgs(process.argv.slice(2));
  const projectNumber = input.apply
    ? runGcloud(['projects', 'describe', input.project, '--format=value(projectNumber)']).trim()
    : '${PROJECT_NUMBER}';
  const plan = buildPlan(input, projectNumber);
  if (!input.apply) {
    console.log(JSON.stringify(plan, null, 2));
    console.log('Dry run only. Re-run with --apply after gcloud authentication and IAM review.');
    return;
  }
  applyPlan(input, plan);
  console.log(`Provisioned ${plan.names.subscription} and monitoring for ${input.consumerServiceId}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { buildPlan, parseArgs, resourceNames, validateEndpoint };
