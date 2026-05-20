CREATE DATABASE IF NOT EXISTS api_center_raw;

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
  'projection.physical_topic.values' = 'test.api-center.audit.log,test.api-center.auth.token-issued,test.api-center.auth.token-refreshed,test.api-center.auth.token-revoked,test.api-center.external.request,test.api-center.gateway.error,test.api-center.gateway.request,test.api-center.gateway.response,test.api-center.registry.service-deprecated,test.api-center.registry.service-deregistered,test.api-center.registry.service-health-changed,test.api-center.registry.service-registered,test.api-center.registry.service-retired,test.api-center.registry.service-version-changed,test.api-center.shared.email.events,test.api-center.shared.gauth.events,test.api-center.shared.geo.events,test.api-center.shared.otp.events,test.api-center.shared.payment.events,test.api-center.shared.sms.events,test.api-center.tribe.request,test.api-center.tribe.response,test.tribe.codex-sdk-20260520041053.events,test.tribe.flow-ci.events,test.tribe.greenovate.events,test.tribe.logistics.events,test.tribe.pakiapps.events,test.tribe.servease.events,test.tribe.shoteam.events,test.tribe.smoke-tribe.events,test.tribe.trinithrive.events',
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
  'projection.physical_topic.values' = 'test.api-center.audit.log,test.api-center.auth.token-issued,test.api-center.auth.token-refreshed,test.api-center.auth.token-revoked,test.api-center.external.request,test.api-center.gateway.error,test.api-center.gateway.request,test.api-center.gateway.response,test.api-center.registry.service-deprecated,test.api-center.registry.service-deregistered,test.api-center.registry.service-health-changed,test.api-center.registry.service-registered,test.api-center.registry.service-retired,test.api-center.registry.service-version-changed,test.api-center.shared.email.events,test.api-center.shared.gauth.events,test.api-center.shared.geo.events,test.api-center.shared.otp.events,test.api-center.shared.payment.events,test.api-center.shared.sms.events,test.api-center.tribe.request,test.api-center.tribe.response,test.tribe.codex-sdk-20260520041053.events,test.tribe.flow-ci.events,test.tribe.greenovate.events,test.tribe.logistics.events,test.tribe.pakiapps.events,test.tribe.servease.events,test.tribe.shoteam.events,test.tribe.smoke-tribe.events,test.tribe.trinithrive.events'
);
