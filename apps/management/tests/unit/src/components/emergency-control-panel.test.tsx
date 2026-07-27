import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmergencyControlPanel } from "../../../../src/components/emergency-control-panel";

describe("EmergencyControlPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("submits an emergency control request", () => {
    const onApply = vi.fn();
    render(<EmergencyControlPanel onApply={onApply} />);

    fireEvent.change(screen.getByLabelText("Target ID"), {
      target: { value: "campus-one" },
    });
    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "pause" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Incident containment" },
    });
    const applyButton = screen.getByRole("button", {
      name: "Apply emergency control",
    }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Confirmation phrase"), {
      target: { value: "APPLY LIVE CHANGE" },
    });
    expect(screen.getByText(/Review before applying/i)).toBeTruthy();
    expect(applyButton.disabled).toBe(false);
    fireEvent.click(applyButton);

    expect(onApply).toHaveBeenCalledWith({
      targetType: "tribe",
      targetId: "campus-one",
      mode: "pause",
      reason: "Incident containment",
      confirmation: {
        typedPhrase: "APPLY LIVE CHANGE",
        reason: "Incident containment",
      },
    });
  });

  it("shows why the emergency action is not ready", () => {
    render(<EmergencyControlPanel onApply={vi.fn()} />);

    expect(screen.getByRole("status", { name: "Before applying" })).toBeTruthy();
    expect(screen.getByText("Target ID: Required")).toBeTruthy();
    expect(screen.getByText("Audit reason: Required")).toBeTruthy();
    expect(screen.getByText("Confirmation phrase: Required")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Target ID"), {
      target: { value: "campus-one" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Incident containment" },
    });
    fireEvent.change(screen.getByLabelText("Confirmation phrase"), {
      target: { value: "APPLY LIVE CHANGE" },
    });

    expect(screen.getByText("Target ID: Ready")).toBeTruthy();
    expect(screen.getByText("Audit reason: Ready")).toBeTruthy();
    expect(screen.getByText("Confirmation phrase: Ready")).toBeTruthy();
  });
});
