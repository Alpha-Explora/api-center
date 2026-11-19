import { MetricsService } from "../../../../apps/gateway/src/metrics/metrics.service";
import { register as promRegister } from "prom-client";

describe("MetricsService", () => {
  beforeEach(() => promRegister.clear());

  it("counts requests by method, route and status", async () => {
    const service = new MetricsService();
    service.recordHttpRequest("POST", "/api/v1/shared/:capability/*path", 201, 0.1);
    service.recordHttpRequest("POST", "/api/v1/shared/:capability/*path", 201, 0.2);

    const metric = await service.httpRequestsTotal.get();
    expect(metric.values.find((v) => v.labels.status_code === "201")?.value).toBe(2);
  });
});
