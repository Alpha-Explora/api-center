#!/usr/bin/env node
const fs = require("node:fs");

const envFile = process.argv[2] || "..\\apicenter-management\\.env.live";

for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)) continue;
  const index = line.indexOf("=");
  process.env[line.slice(0, index).trim()] = line
    .slice(index + 1)
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

const required = [
  "CONFLUENT_ENVIRONMENT_ID",
  "CONFLUENT_KAFKA_CLUSTER_ID",
  "CONFLUENT_S3_CONNECTOR_NAME",
  "CONFLUENT_CLOUD_API_KEY",
  "CONFLUENT_CLOUD_API_SECRET",
];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} is required.`);
  }
}

const url =
  `https://api.confluent.cloud/connect/v1/environments/${process.env.CONFLUENT_ENVIRONMENT_ID}` +
  `/clusters/${process.env.CONFLUENT_KAFKA_CLUSTER_ID}` +
  `/connectors/${process.env.CONFLUENT_S3_CONNECTOR_NAME}/config`;
const auth = Buffer.from(
  `${process.env.CONFLUENT_CLOUD_API_KEY}:${process.env.CONFLUENT_CLOUD_API_SECRET}`,
).toString("base64");

fetch(url, { headers: { Authorization: `Basic ${auth}` } })
  .then(async (response) => {
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Confluent config request failed with ${response.status}`);
    }
    return body;
  })
  .then((config) => {
    const topics = String(config.topics || "")
      .split(",")
      .map((topic) => topic.trim())
      .filter(Boolean);

    console.log(
      JSON.stringify(
        {
          connector: process.env.CONFLUENT_S3_CONNECTOR_NAME,
          flush_size: config["flush.size"],
          time_interval: config["time.interval"],
          rotate_interval_ms: config["rotate.interval.ms"],
          rotate_schedule_interval_ms: config["rotate.schedule.interval.ms"],
          topics_count: topics.length,
          includes_logistics: topics.includes("prod.tribe.logistics.events"),
        },
        null,
        2,
      ),
    );
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
