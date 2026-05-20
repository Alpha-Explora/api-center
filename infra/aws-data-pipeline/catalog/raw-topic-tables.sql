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
  'projection.physical_topic.type' = 'injected',
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
