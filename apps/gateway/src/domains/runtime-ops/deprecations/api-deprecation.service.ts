import { Injectable } from "@nestjs/common";

@Injectable()
export class ApiDeprecationService {
  evaluate(input: {
    productId: string;
    deprecatedAt?: string;
    sunsetAt?: string;
    consumers: string[];
  }) {
    if (!input.deprecatedAt) {
      return { status: "active", impactedConsumers: [] };
    }

    return {
      status:
        input.sunsetAt && Date.parse(input.sunsetAt) <= Date.now()
          ? "sunset"
          : "deprecated",
      impactedConsumers: input.consumers,
      nextAction:
        input.consumers.length > 0
          ? "Notify impacted consumers and track migration."
          : "No active consumers; product can be retired after approval.",
    };
  }
}
