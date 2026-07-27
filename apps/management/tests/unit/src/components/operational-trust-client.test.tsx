import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OperationalTrustClient } from "../../../../src/components/operational-trust-client";

describe("OperationalTrustClient", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the trust sections operators need before promotion", () => {
    render(
      <OperationalTrustClient
        driftItems={[]}
        dependencyEdges={[]}
        evidenceSections={[]}
        scorecards={[]}
      />,
    );

    expect(screen.getByText("Emergency controls")).toBeTruthy();
    expect(screen.getByText("Governance drift")).toBeTruthy();
    expect(screen.getByText("Runtime dependency map")).toBeTruthy();
    expect(screen.getByText("Promotion evidence")).toBeTruthy();
    expect(screen.getByText("Consumer scorecards")).toBeTruthy();
  });

  it("renders provided runtime dependency and scorecard data", () => {
    render(
      <OperationalTrustClient
        driftItems={[]}
        dependencyEdges={[
          {
            from: "campus-one",
            to: "payment-service",
            type: "shared-service",
          },
        ]}
        evidenceSections={[{ key: "health", status: "pass" }]}
        scorecards={[
          { ownerTribeId: "campus-one", status: "healthy", findings: [] },
        ]}
      />,
    );

    expect(screen.getByText("payment-service")).toBeTruthy();
    expect(screen.getAllByText("campus-one").length).toBeGreaterThan(0);
  });

  it("uses one severity-first trust review detail surface", () => {
    render(
      <OperationalTrustClient
        driftItems={[
          {
            severity: "warning",
            resourceType: "quota",
            resourceId: "quota-1",
            ownerTribeId: "campus-one",
            message: "Quota policy is in observe mode.",
          },
          {
            severity: "critical",
            resourceType: "secret",
            resourceId: "secret-1",
            ownerTribeId: "library",
            message: "Tribe secret rotation is overdue.",
          },
        ]}
        dependencyEdges={[
          { from: "library", to: "payment-service", type: "shared-service" },
        ]}
        evidenceSections={[
          { key: "health-check", status: "pass" },
          {
            key: "smoke-test",
            status: "fail",
            data: { serviceId: "campus-one" },
          },
        ]}
        scorecards={[
          {
            ownerTribeId: "campus-one",
            status: "needs_review",
            findings: ["Consumer scorecard needs review."],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Selected operational trust detail")).toBeTruthy();
    expect(screen.getByText("Selected trust signal")).toBeTruthy();
    expect(screen.getAllByText("Tribe secret rotation is overdue.").length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("link", { name: /open library service detail/i })
        .getAttribute("href"),
    ).toBe("/tribes/library?section=governance");
    expect(
      screen.getByRole("button", {
        name: "Inspect operational trust signal Promotion evidence smoke-test",
        pressed: false,
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect operational trust signal Promotion evidence smoke-test",
      }),
    );

    expect(screen.getAllByText("smoke-test evidence is failing.").length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("link", { name: /open promotion gates/i })
        .getAttribute("href"),
    ).toBe("/tribes/campus-one?section=governance");
    expect(
      screen.getByRole("button", {
        name: "Inspect operational trust signal Promotion evidence smoke-test",
        pressed: true,
      }),
    ).toBeTruthy();
  });

  it("routes owner-scoped scorecard signals to service detail instead of separate workflow pages", () => {
    render(
      <OperationalTrustClient
        driftItems={[]}
        dependencyEdges={[]}
        evidenceSections={[]}
        scorecards={[
          {
            ownerTribeId: "field-services",
            status: "needs_attention",
            findings: ["SDK version is behind the platform contract."],
          },
        ]}
      />,
    );

    expect(
      screen
        .getByRole("link", { name: /open field-services service detail/i })
        .getAttribute("href"),
    ).toBe("/tribes/field-services?section=governance");
  });

  it("labels unavailable operational trust sections without hiding the workflow", () => {
    render(
      <OperationalTrustClient
        driftItems={[]}
        dependencyEdges={[]}
        evidenceSections={[]}
        scorecards={[
          {
            ownerTribeId: "campus-one",
            status: "needs_review",
            findings: ["Quota policy is in observe mode."],
          },
        ]}
        unavailableSections={[
          {
            key: "dependencies",
            label: "Runtime dependency map",
            reason: "dependency map unavailable",
          },
        ]}
      />,
    );

    expect(screen.getByText("Runtime dependency map unavailable")).toBeTruthy();
    expect(screen.getByText("dependency map unavailable")).toBeTruthy();
    expect(screen.getByText("Emergency controls")).toBeTruthy();
    expect(screen.getAllByText("campus-one").length).toBeGreaterThan(0);
  });
});
