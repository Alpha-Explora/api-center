import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../../../apps/gateway/src/app.module";

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
  match(path: string): boolean;
};

describe("gateway route table", () => {
  let app: INestApplication;
  let routes: { path: string; methods: string[]; layer: Layer }[];

  beforeAll(async () => {
    // Preview mode registers every controller's routes without constructing providers, so no
    // database or secrets are needed and the route table is the one production builds.
    app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false });
    app.setGlobalPrefix("api/v1");
    await app.init();
    const stack = (app.getHttpAdapter().getInstance() as { router: { stack: Layer[] } }).router.stack;
    routes = stack.filter((layer) => layer.route).map((layer) => ({
      path: layer.route!.path,
      methods: Object.keys(layer.route!.methods),
      layer,
    }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("registers the gateway's routes", () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.map((route) => route.path)).toContain("/api/v1/shared/payment/webhooks/:environment");
  });

  // Express answers with the first registered route that matches. A broader route listed earlier
  // silently takes a narrower one's requests: PayMongo's webhooks got the capability proxy's
  // "An application key is required" from 2026-11-19 to 2026-11-21.
  it("never lets an earlier route take a later route's requests", () => {
    const shadowed = routes.flatMap((route, index) => {
      const sample = samplePath(route.path);
      return route.methods.flatMap((method) => {
        const winner = routes.slice(0, index).find((earlier) =>
          (earlier.methods.includes(method) || earlier.methods.includes("_all")) && earlier.layer.match(sample));
        return winner ? [`${method.toUpperCase()} ${route.path} is taken by ${winner.path} (sample ${sample})`] : [];
      });
    });

    expect(shadowed).toEqual([]);
  });
});

/** A concrete URL the route accepts: parameters become words, wildcards two segments. */
function samplePath(path: string): string {
  return path
    .replace(/\{\*[A-Za-z0-9_]+\}|\*[A-Za-z0-9_]+/g, "w1/w2")
    .replace(/:[A-Za-z0-9_]+/g, "p")
    .replace(/[{}]/g, "");
}
