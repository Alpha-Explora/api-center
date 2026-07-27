import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  emptyRegistryFilters,
  RegistryFiltersPanel,
} from "@/components/registry-filters";

describe("RegistryFiltersPanel", () => {
  it("labels every registry filter control", () => {
    const onChange = vi.fn();

    render(
      <RegistryFiltersPanel value={emptyRegistryFilters} onChange={onChange} />,
    );

    expect(screen.getByLabelText("Search registry")).toBeTruthy();
    expect(screen.getByLabelText("Filter by owner team")).toBeTruthy();
    expect(screen.getByLabelText("Filter by service type")).toBeTruthy();
    expect(screen.getByLabelText("Filter by service status")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search registry"), {
      target: { value: "payment" },
    });

    expect(onChange).toHaveBeenCalledWith({
      ...emptyRegistryFilters,
      query: "payment",
    });
  });
});
