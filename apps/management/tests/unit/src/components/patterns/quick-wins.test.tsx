import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Panel } from "@/components/patterns/panel";
import { RelativeTime } from "@/components/patterns/relative-time";
import { ActorLabel } from "@/components/patterns/actor-label";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime } from "@/lib/format";
import { findProjectOrganization } from "@/features/control-plane/view-models/project-environment";

afterEach(cleanup);

describe("Panel", () => {
  it("renders no empty body under a header-only panel", () => {
    const { container } = render(<Panel title="Archive project" description="Stops every request." />);
    expect(container.querySelector("section")?.children).toHaveLength(1);
  });

  it("renders the body when there is one", () => {
    const { container } = render(<Panel title="Roles">rows</Panel>);
    expect(container.querySelector("section")?.children).toHaveLength(2);
  });
});

describe("RelativeTime", () => {
  it("shows the exact time on hover and as machine-readable time", () => {
    const value = new Date(Date.now() - 16 * 60 * 1000);
    render(<RelativeTime value={value} />);
    const time = screen.getByText("16 minutes ago");
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("title")).toBe(formatDateTime(value));
    expect(time.getAttribute("dateTime")).toBe(value.toISOString());
  });

  it("shows a dash for a missing time", () => {
    render(<RelativeTime value={null} />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("ActorLabel and StatusBadge", () => {
  it("shows a platform actor's name with a quiet note", () => {
    render(<ActorLabel actor="platform:abtorres.it@alphaexplora.com" />);
    expect(screen.getByText("abtorres.it@alphaexplora.com")).toBeTruthy();
    expect(screen.getByText("via platform")).toBeTruthy();
  });

  it("capitalizes a status", () => {
    render(<StatusBadge status="provisioning" />);
    expect(screen.getByText("Provisioning")).toBeTruthy();
  });
});

describe("findProjectOrganization", () => {
  it("returns the first organization that has the project", async () => {
    const load = vi.fn(async (organizationId: string) => {
      if (organizationId !== "org-b") throw new Error("not found");
      return {};
    });
    await expect(findProjectOrganization("prj_1", ["org-a", "org-b", "org-c"], load)).resolves.toBe("org-b");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("returns null when none has it", async () => {
    await expect(findProjectOrganization("prj_1", ["org-a"], async () => Promise.reject(new Error("no")))).resolves.toBeNull();
  });
});
