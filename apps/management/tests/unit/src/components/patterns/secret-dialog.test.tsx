import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretDialog } from "@/components/patterns/secret-dialog";

describe("SecretDialog", () => {
  afterEach(cleanup);

  it("stays open on Escape and closes only when the person says they stored the secret", async () => {
    const onClose = vi.fn();
    render(<SecretDialog secret="ak_test_secret" title="Key issued" description="Copy it now." onClose={onClose} />);

    const secret = await screen.findByText("ak_test_secret");
    fireEvent.keyDown(secret, { key: "Escape" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("ak_test_secret")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "I stored it" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
