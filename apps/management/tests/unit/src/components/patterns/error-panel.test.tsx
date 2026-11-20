import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorPanel } from "@/components/patterns/notices";
import { ApiError } from "@/lib/api-center/client-core";

describe("ErrorPanel", () => {
  afterEach(cleanup);

  it("explains a busy gateway in plain words and retries the failed queries", async () => {
    const client = new QueryClient();
    const refetch = vi.spyOn(client, "refetchQueries").mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={client}>
        <ErrorPanel title="Readiness is unavailable" error={new ApiError("APICenter is busy. Retry shortly.", 503, "DATABASE_BUSY")} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("APICenter is busy or starting up. This usually clears in a few seconds.")).toBeTruthy();
    // The code is kept for support, behind Details.
    expect(screen.getByText("DATABASE_BUSY").closest("details")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(refetch).toHaveBeenCalledWith(expect.objectContaining({ type: "active" })));
  });

  it("shows the gateway's own message and no retry for an answer such as 403", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ErrorPanel error={new ApiError("Your role does not allow project manage", 403, "FORBIDDEN")} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Your role does not allow project manage")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
