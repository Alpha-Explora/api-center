const baseUrl = process.env.APICENTER_CLOUD_RUN_BASE_URL;
const spikeConcurrency = Number.parseInt(
  process.env.APICENTER_CLOUD_RUN_SPIKE_CONCURRENCY || "10",
  10,
);
const spikeRequests = Number.parseInt(
  process.env.APICENTER_CLOUD_RUN_SPIKE_REQUESTS || "100",
  10,
);
const spikeP95LimitMs = Number.parseInt(
  process.env.APICENTER_CLOUD_RUN_SPIKE_P95_MS || "1500",
  10,
);

if (!baseUrl) {
  throw new Error(
    "Set APICENTER_CLOUD_RUN_BASE_URL before running smoke:cloud-run",
  );
}

async function timedFetch(path, options = {}) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}${path}`, options);
  const ms = Date.now() - started;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${path} returned ${response.status}: ${text.slice(0, 300)}`,
    );
  }
  return { status: response.status, ms, text };
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

async function runSpikeCheck() {
  const queue = Array.from({ length: spikeRequests }, (_, index) => index + 1);
  const results = [];

  async function worker() {
    while (queue.length > 0) {
      const requestNumber = queue.shift();
      if (!requestNumber) return;
      try {
        const result = await timedFetch("/api/v1/health/ready");
        results.push({
          requestNumber,
          ok: true,
          status: result.status,
          ms: result.ms,
        });
      } catch (error) {
        results.push({
          requestNumber,
          ok: false,
          status: 0,
          ms: spikeP95LimitMs + 1,
          error: error.message,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: spikeConcurrency }, () => worker()));

  const failures = results.filter((item) => !item.ok);
  const latencies = results.map((item) => item.ms);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);

  console.table([
    {
      check: "bounded-spike",
      requests: results.length,
      concurrency: spikeConcurrency,
      failures: failures.length,
      p95,
      p99,
    },
  ]);

  if (failures.length > 0) {
    throw new Error(`Spike check had ${failures.length} failed request(s)`);
  }
  if (p95 > spikeP95LimitMs) {
    throw new Error(`Spike check p95 ${p95}ms exceeded ${spikeP95LimitMs}ms`);
  }
}

async function main() {
  const results = [];
  results.push({ name: "live", ...(await timedFetch("/api/v1/health/live")) });
  results.push({
    name: "ready",
    ...(await timedFetch("/api/v1/health/ready")),
  });

  for (let index = 0; index < 5; index += 1) {
    const result = await timedFetch("/api/v1/health/ready");
    results.push({ name: `ready-warm-${index + 1}`, ...result });
  }

  console.table(
    results.map((item) => ({
      check: item.name,
      status: item.status,
      ms: item.ms,
    })),
  );

  const slow = results.filter((item) => item.ms > 1000);
  if (slow.length > 0) {
    throw new Error(
      `Cloud Run smoke had ${slow.length} response(s) over 1000ms`,
    );
  }

  await runSpikeCheck();
}

main().catch((error) => {
  console.error(`Cloud Run smoke failed: ${error.message}`);
  process.exit(1);
});
