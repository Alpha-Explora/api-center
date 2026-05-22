CREATE DATABASE IF NOT EXISTS api_center_raw;

-- Keep projection.physical_topic.values synchronized with:
--   infra/aws-data-pipeline/topic-projection-values.txt
-- Generate the sorted comma-separated enum with:
--   node scripts/data-pipeline/resolve-athena-topic-projection.js -TopicsFile infra/aws-data-pipeline/topic-projection-values.txt

CREATE EXTERNAL TABLE IF NOT EXISTS api_center_raw.topic_records (
  raw_line string
)
PARTITIONED BY (
  physical_topic string,
  year string,
  month string,
  day string,
  hour string
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe'
WITH SERDEPROPERTIES (
  'serialization.format' = '1'
)
STORED AS TEXTFILE
LOCATION 's3://api-center-raw-data/topics/'
TBLPROPERTIES (
  'projection.enabled' = 'true',
  'projection.physical_topic.type' = 'enum',
  'projection.physical_topic.values' = 'prod.api-center.audit.log,prod.api-center.auth.token-issued,prod.api-center.auth.token-refreshed,prod.api-center.auth.token-revoked,prod.api-center.external.request,prod.api-center.gateway.error,prod.api-center.gateway.request,prod.api-center.gateway.response,prod.api-center.pipeline.athena-query-execution,prod.api-center.registry.service-deprecated,prod.api-center.registry.service-deregistered,prod.api-center.registry.service-health-changed,prod.api-center.registry.service-registered,prod.api-center.registry.service-retired,prod.api-center.registry.service-version-changed,prod.api-center.shared.email.events,prod.api-center.shared.gauth.events,prod.api-center.shared.geo.events,prod.api-center.shared.otp.events,prod.api-center.shared.payment.events,prod.api-center.shared.sms.events,prod.api-center.tribe.request,prod.api-center.tribe.response,prod.tribe.church-donations.events,prod.tribe.flow-ci.events,prod.tribe.greenovate.events,prod.tribe.logistics.events,prod.tribe.pakiapps.events,prod.tribe.servease.events,prod.tribe.shoteam.events,prod.tribe.smoke-tribe.events,prod.tribe.trinithrive.events,test.api-center.audit.log,test.api-center.auth.token-issued,test.api-center.auth.token-refreshed,test.api-center.auth.token-revoked,test.api-center.external.request,test.api-center.gateway.error,test.api-center.gateway.request,test.api-center.gateway.response,test.api-center.pipeline.athena-query-execution,test.api-center.registry.service-deprecated,test.api-center.registry.service-deregistered,test.api-center.registry.service-health-changed,test.api-center.registry.service-registered,test.api-center.registry.service-retired,test.api-center.registry.service-version-changed,test.api-center.shared.email.events,test.api-center.shared.gauth.events,test.api-center.shared.geo.events,test.api-center.shared.otp.events,test.api-center.shared.payment.events,test.api-center.shared.sms.events,test.api-center.tribe.request,test.api-center.tribe.response,test.tribe.codex-sdk-20260520041053.events,test.tribe.flow-ci.events,test.tribe.greenovate.events,test.tribe.logistics.events,test.tribe.pakiapps.events,test.tribe.servease.events,test.tribe.shoteam.events,test.tribe.smoke-tribe.events,test.tribe.smurf-village.events,test.tribe.trinithrive.events',
  'projection.year.type' = 'integer',
  'projection.year.range' = '2026,2035',
  'projection.year.digits' = '4',
  'projection.month.type' = 'integer',
  'projection.month.range' = '1,12',
  'projection.month.digits' = '2',
  'projection.day.type' = 'integer',
  'projection.day.range' = '1,31',
  'projection.day.digits' = '2',
  'projection.hour.type' = 'integer',
  'projection.hour.range' = '0,23',
  'projection.hour.digits' = '2',
  'storage.location.template' = 's3://api-center-raw-data/topics/${physical_topic}/year=${year}/month=${month}/day=${day}/hour=${hour}/'
);

ALTER TABLE api_center_raw.topic_records SET TBLPROPERTIES (
  'projection.physical_topic.type' = 'enum',
  'projection.physical_topic.values' = 'prod.api-center.audit.log,prod.api-center.auth.token-issued,prod.api-center.auth.token-refreshed,prod.api-center.auth.token-revoked,prod.api-center.external.request,prod.api-center.gateway.error,prod.api-center.gateway.request,prod.api-center.gateway.response,prod.api-center.pipeline.athena-query-execution,prod.api-center.registry.service-deprecated,prod.api-center.registry.service-deregistered,prod.api-center.registry.service-health-changed,prod.api-center.registry.service-registered,prod.api-center.registry.service-retired,prod.api-center.registry.service-version-changed,prod.api-center.shared.email.events,prod.api-center.shared.gauth.events,prod.api-center.shared.geo.events,prod.api-center.shared.otp.events,prod.api-center.shared.payment.events,prod.api-center.shared.sms.events,prod.api-center.tribe.request,prod.api-center.tribe.response,prod.tribe.church-donations.events,prod.tribe.flow-ci.events,prod.tribe.greenovate.events,prod.tribe.logistics.events,prod.tribe.pakiapps.events,prod.tribe.servease.events,prod.tribe.shoteam.events,prod.tribe.smoke-tribe.events,prod.tribe.trinithrive.events,test.api-center.audit.log,test.api-center.auth.token-issued,test.api-center.auth.token-refreshed,test.api-center.auth.token-revoked,test.api-center.external.request,test.api-center.gateway.error,test.api-center.gateway.request,test.api-center.gateway.response,test.api-center.pipeline.athena-query-execution,test.api-center.registry.service-deprecated,test.api-center.registry.service-deregistered,test.api-center.registry.service-health-changed,test.api-center.registry.service-registered,test.api-center.registry.service-retired,test.api-center.registry.service-version-changed,test.api-center.shared.email.events,test.api-center.shared.gauth.events,test.api-center.shared.geo.events,test.api-center.shared.otp.events,test.api-center.shared.payment.events,test.api-center.shared.sms.events,test.api-center.tribe.request,test.api-center.tribe.response,test.tribe.codex-sdk-20260520041053.events,test.tribe.flow-ci.events,test.tribe.greenovate.events,test.tribe.logistics.events,test.tribe.pakiapps.events,test.tribe.servease.events,test.tribe.shoteam.events,test.tribe.smoke-tribe.events,test.tribe.smurf-village.events,test.tribe.trinithrive.events'
);
