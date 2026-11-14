import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SecretOnce } from "@/features/control-plane/views/project-view";

describe("SecretOnce", () => {
  afterEach(cleanup);

  it("shows a newly issued key once and closes when the user confirms storing it", () => {
    const onClose = vi.fn();
    render(
      <SecretOnce
        credential={{ id: "crd_x", lookupPrefix: "ak_test_abc", expiresAt: "2027-01-01T00:00:00Z", secret: "ak_test_abcdefghijklmnop_secret" }}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("ak_test_abcdefghijklmnop_secret")).toBeTruthy();
    expect(screen.getByText(/will not be shown again/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I stored it" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing without a credential", () => {
    render(<SecretOnce credential={null} onClose={vi.fn()} />);
    expect(screen.queryByText(/Copy this key now/)).toBeNull();
  });
});
