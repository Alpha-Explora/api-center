import { Injectable } from "@nestjs/common";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import type { ServiceRegistryEntry } from "../../../types";

const mapping = z.array(
  z
    .object({
      serviceId: z.string(),
      environment: z.enum(["test", "live"]),
      project: z.string().regex(/^[a-z0-9-]+$/),
      region: z.string().regex(/^[a-z]+-[a-z]+[0-9]$/),
      service: z.string().regex(/^[a-z0-9-]+$/),
    })
    .strict(),
);
const serviceSchema = z.object({
  status: z.object({
    url: z.string().url(),
    latestReadyRevisionName: z.string(),
    traffic: z.array(
      z.object({ revisionName: z.string(), percent: z.number() }),
    ),
  }),
});
const revisionSchema = z.object({
  status: z.object({ imageDigest: z.string().regex(/@sha256:[a-f0-9]{64}$/) }),
});
export type RuntimeDeployment = {
  serviceId: string;
  revision: string;
  imageDigest: string;
  baseUrl: string;
};

@Injectable()
export class RuntimeDeploymentObserver {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  async observe(
    entries: ServiceRegistryEntry[],
    environment: "test" | "live",
  ): Promise<{ complete: boolean; deployments: RuntimeDeployment[] }> {
    let configured: z.infer<typeof mapping>;
    try {
      configured = mapping.parse(
        JSON.parse(process.env.APICENTER_VERIFICATION_DEPLOYMENTS ?? "[]"),
      );
    } catch {
      return { complete: false, deployments: [] };
    }
    const deployments = await Promise.all(
      entries.map(async (entry): Promise<RuntimeDeployment | null> => {
        const target = configured.find(
          (item) =>
            item.serviceId === entry.serviceId &&
            item.environment === environment,
        );
        const expectedUrl = entry.environments.find(
          (row) => row.environment === environment,
        )?.baseUrl;
        if (!target || !expectedUrl) return null;
        try {
          const base = `https://${target.region}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${target.project}`;
          const response = await this.auth.request<unknown>({
            url: `${base}/services/${target.service}`,
            timeout: 5000,
          });
          const observed = serviceSchema.parse(response.data).status;
          if (
            observed.traffic.length !== 1 ||
            observed.traffic[0].percent !== 100 ||
            observed.traffic[0].revisionName !==
              observed.latestReadyRevisionName ||
            new URL(observed.url).origin !== new URL(expectedUrl).origin
          )
            return null;
          const revision = await this.auth.request<unknown>({
            url: `${base}/revisions/${encodeURIComponent(observed.latestReadyRevisionName)}`,
            timeout: 5000,
          });
          const digest = revisionSchema.parse(revision.data).status.imageDigest;
          return {
            serviceId: entry.serviceId,
            revision: observed.latestReadyRevisionName,
            imageDigest: digest,
            baseUrl: observed.url,
          };
        } catch {
          return null;
        }
      }),
    );
    return {
      complete:
        deployments.length === entries.length &&
        deployments.every((item) => item !== null),
      deployments: deployments
        .filter((item) => item !== null)
        .sort((a, b) => a.serviceId.localeCompare(b.serviceId)),
    };
  }
}
