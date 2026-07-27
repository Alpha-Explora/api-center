import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComplianceExportPanel } from "../../../../src/components/compliance-export-panel";

describe("ComplianceExportPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("submits an evidence export range", () => {
    const onExport = vi.fn();
    render(<ComplianceExportPanel onExport={onExport} />);

    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-05-01" },
    });
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2026-05-25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export evidence" }));

    expect(onExport).toHaveBeenCalledWith({
      from: "2026-05-01",
      to: "2026-05-25",
      format: "json",
    });
  });

  it("labels the export format selector", () => {
    const onExport = vi.fn();
    render(<ComplianceExportPanel onExport={onExport} />);

    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-05-01" },
    });
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2026-05-25" },
    });
    fireEvent.change(screen.getByLabelText("Evidence format"), {
      target: { value: "md" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export evidence" }));

    expect(onExport).toHaveBeenCalledWith({
      from: "2026-05-01",
      to: "2026-05-25",
      format: "md",
    });
  });

  it("requires a date range before export", () => {
    render(<ComplianceExportPanel onExport={vi.fn()} />);

    expect(screen.getByLabelText("From date")).toHaveProperty("required", true);
    expect(screen.getByLabelText("To date")).toHaveProperty("required", true);
  });
});
