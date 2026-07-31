import { Injectable, Optional } from "@nestjs/common";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

type IamRequest = {
  url: string;
  method: "GET" | "POST";
  data?: unknown;
};

export type IamRequestClient = {
  request<T>(options: IamRequest): Promise<{ data: T }>;
};

const IamInput = z.object({
  projectId: z.string().min(1),
  topicName: z.string().min(1),
  deadLetterTopicName: z.string().min(1),
  subscriptionName: z.string().min(1),
  deliveryServiceAccountEmail: z.string().email(),
  consumerProjectId: z.string().min(1),
  cloudRunRegion: z.string().min(1),
  cloudRunServiceName: z.string().min(1),
});

export type PaymentPubSubIamResult =
  | { status: "skipped"; reason: "disabled" }
  | { status: "applied"; projectNumber: string; resources: string[] };

@Injectable()
export class PaymentPubSubIamProvisioningService {
  constructor(@Optional() private readonly requestClient?: IamRequestClient) {}

  async provision(input: unknown): Promise<PaymentPubSubIamResult> {
    if (process.env.PAYMENT_PUBSUB_IAM_ENABLED !== "true") {
      return { status: "skipped", reason: "disabled" };
    }

    const parsed = IamInput.parse(input);
    const projectNumber = await this.projectNumber(parsed.projectId);
    const pubSubAgent = `service-${projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`;
    const resources: string[] = [];

    await this.grant(
      `https://pubsub.googleapis.com/v1/projects/${parsed.projectId}/topics/${parsed.deadLetterTopicName}`,
      "roles/pubsub.publisher",
      `serviceAccount:${pubSubAgent}`,
    );
    resources.push("dead-letter-topic:roles/pubsub.publisher");

    await this.grant(
      `https://pubsub.googleapis.com/v1/projects/${parsed.projectId}/subscriptions/${parsed.subscriptionName}`,
      "roles/pubsub.subscriber",
      `serviceAccount:${pubSubAgent}`,
    );
    resources.push("source-subscription:roles/pubsub.subscriber");

    await this.grant(
      `https://iam.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(parsed.deliveryServiceAccountEmail)}`,
      "roles/iam.serviceAccountTokenCreator",
      `serviceAccount:${pubSubAgent}`,
    );
    resources.push("delivery-service-account:roles/iam.serviceAccountTokenCreator");

    await this.grant(
      `https://run.googleapis.com/v2/projects/${parsed.consumerProjectId}/locations/${parsed.cloudRunRegion}/services/${parsed.cloudRunServiceName}`,
      "roles/run.invoker",
      `serviceAccount:${parsed.deliveryServiceAccountEmail}`,
    );
    resources.push("consumer-cloud-run:roles/run.invoker");

    return { status: "applied", projectNumber, resources };
  }

  private async projectNumber(projectId: string): Promise<string> {
    const response = await this.request<{ projectNumber?: string | number }>({
      url: `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`,
      method: "GET",
    });
    const value = response.data.projectNumber;
    if (value === undefined || value === null) {
      throw new Error(`Cloud Resource Manager returned no project number for ${projectId}`);
    }
    return String(value);
  }

  private async grant(resourceUrl: string, role: string, member: string): Promise<void> {
    const policyResponse = await this.request<{
      bindings?: Array<{ role: string; members?: string[] }>;
      etag?: string;
      version?: number;
    }>({
      url: `${resourceUrl}:getIamPolicy`,
      method: "GET",
    });
    const policy = policyResponse.data ?? {};
    const bindings = [...(policy.bindings ?? [])];
    const binding = bindings.find((candidate) => candidate.role === role);
    if (binding) {
      binding.members = Array.from(new Set([...(binding.members ?? []), member]));
    } else {
      bindings.push({ role, members: [member] });
    }
    await this.request({
      url: `${resourceUrl}:setIamPolicy`,
      method: "POST",
      data: { policy: { ...policy, bindings } },
    });
  }

  private async request<T>(options: IamRequest): Promise<{ data: T }> {
    if (this.requestClient) return this.requestClient.request<T>(options);
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const client = await auth.getClient();
    return client.request<T>(options);
  }
}