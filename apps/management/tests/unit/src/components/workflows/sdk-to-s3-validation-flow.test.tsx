import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SdkToS3ValidationFlow } from "../../../../../src/components/workflows/sdk-to-s3-validation-flow";

describe("SdkToS3ValidationFlow", () => {
  it("shows sdk, gateway, event, and s3 validation steps", () => {
    render(
      <SdkToS3ValidationFlow
        sdkConfigured
        gatewayEventsSeen
        kafkaEventsSeen={false}
        s3ObjectsSeen={false}
      />,
    );

    expect(screen.getByText("SDK configured")).toBeTruthy();
    expect(screen.getByText("Gateway events observed")).toBeTruthy();
    expect(screen.getByText("Kafka events observed")).toBeTruthy();
    expect(screen.getByText("S3 objects observed")).toBeTruthy();
  });
});
