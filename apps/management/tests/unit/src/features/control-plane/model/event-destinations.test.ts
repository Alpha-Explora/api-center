import { describe, expect, it } from "vitest";
import {
  createOutcome,
  destinationEndpoint,
  liveDestinationFor,
  publicHttpsUrlProblem,
  sortDestinations,
  webhookBody,
  webhookFormSchema,
  type EventDestination,
} from "@/features/control-plane/model/event-destinations";
import { fieldErrors } from "@/features/control-plane/model/form-errors";

const APP = "app_aaaaaaaaaaaaaaaaaaaaaaaa";

const destination = (patch: Partial<EventDestination> = {}): EventDestination => ({
  id: "dst_aaaaaaaaaaaaaaaaaaaaaaaa",
  projectId: "prj_aaaaaaaaaaaaaaaaaaaaaaaa",
  environmentId: "env_1",
  recipientApplicationId: APP,
  eventFamily: "payments",
  transport: "webhook",
  pushEndpoint: "https://delivery.apicenter.example/deliveries/dst_a",
  oidcAudience: "https://delivery.apicenter.example",
  deliveryServiceAccountEmail: "push@apicenter.iam.gserviceaccount.com",
  subscriptionName: "sub",
  webhookUrl: "https://shop.example.com/hooks",
  secretRotatedAt: null,
  status: "active",
  lastError: null,
  createdBy: "dev@example.com",
  createdAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
  ...patch,
});

describe("webhook create outcome", () => {
  it("treats a 200 with status failed as a failure carrying lastError", () => {
    const failed = { ...destination({ status: "failed", lastError: "Pub/Sub refused the subscription" }), signingSecret: "whsec_x" };
    expect(createOutcome(failed)).toEqual({ kind: "failed", destination: failed, error: "Pub/Sub refused the subscription" });
    expect(createOutcome(destination({ status: "failed" }))).toMatchObject({ kind: "failed", error: expect.stringMatching(/without a reason/) });
    expect(createOutcome(destination())).toMatchObject({ kind: "created" });
  });
});

describe("destinations per application", () => {
  it("ignores disabled destinations when finding an application's destination", () => {
    const disabled = destination({ id: "dst_old", status: "disabled" });
    const failed = destination({ id: "dst_new", status: "failed" });
    expect(liveDestinationFor(APP, [disabled])).toBeUndefined();
    expect(liveDestinationFor(APP, [disabled, failed])?.id).toBe("dst_new");
  });

  it("lists disabled destinations last, newest first", () => {
    const rows = sortDestinations([
      destination({ id: "a", status: "disabled", createdAt: "2026-11-12T00:00:00.000Z" }),
      destination({ id: "b", createdAt: "2026-11-01T00:00:00.000Z" }),
      destination({ id: "c", status: "failed", createdAt: "2026-11-05T00:00:00.000Z" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["c", "b", "a"]);
  });

  it("shows the customer's URL for webhooks and the push endpoint for Pub/Sub", () => {
    expect(destinationEndpoint(destination())).toBe("https://shop.example.com/hooks");
    expect(destinationEndpoint(destination({ transport: "pubsub-push", webhookUrl: null, pushEndpoint: "https://events.example.com/push" }))).toBe(
      "https://events.example.com/push",
    );
  });
});

describe("webhook URL", () => {
  it("accepts public https URLs only", () => {
    expect(publicHttpsUrlProblem("https://shop.example.com/hooks")).toBeNull();
    expect(publicHttpsUrlProblem("http://shop.example.com/hooks")).toMatch(/https/);
    expect(publicHttpsUrlProblem("https://user:pw@shop.example.com/hooks")).toMatch(/user name/);
    expect(publicHttpsUrlProblem("https://localhost/hooks")).toMatch(/public/);
    expect(publicHttpsUrlProblem("https://10.0.0.4/hooks")).toMatch(/public/);
    expect(publicHttpsUrlProblem("https://192.168.1.1/hooks")).toMatch(/public/);
    expect(publicHttpsUrlProblem("https://metadata.google.internal/")).toMatch(/public/);
    expect(publicHttpsUrlProblem("shop.example.com")).toMatch(/full URL/);
  });

  it("builds the webhook body and requires an application", () => {
    expect(webhookBody({ recipientApplicationId: APP, url: " https://shop.example.com/hooks " })).toEqual({
      recipientApplicationId: APP,
      url: "https://shop.example.com/hooks",
    });
    expect(fieldErrors(webhookFormSchema.safeParse({ recipientApplicationId: "", url: "https://shop.example.com" }).error)).toHaveProperty(
      "recipientApplicationId",
    );
  });
});
