import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExpiryBadge } from "@/features/control-plane/views/applications/expiry-badge";

afterEach(cleanup);

describe("times inside sentences", () => {
  it("renders an expiry as words with the exact time on hover, not markup as text", () => {
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const { container } = render(<ExpiryBadge credential={{ status: "active", expiresAt }} />);
    expect(container.textContent).toBe("Expires in 3 days");
    expect(container.textContent).not.toContain("<");
    expect(screen.getByText("in 3 days").tagName).toBe("TIME");
  });
});
