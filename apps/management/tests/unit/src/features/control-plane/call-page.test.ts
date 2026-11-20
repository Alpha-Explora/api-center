import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-center/client-core", () => ({ request }));

import { callPage } from "@/features/control-plane/data/http";

describe("callPage", () => {
  afterEach(() => request.mockReset());

  it("returns the page and the next cursor, and passes a cursor back", async () => {
    request.mockResolvedValueOnce({ data: [{ email: "a@x.test" }], meta: { nextCursor: "abc" } });
    const first = await callPage(z.object({ email: z.string() }), "organizations/o/members?limit=100");
    expect(first).toEqual({ items: [{ email: "a@x.test" }], nextCursor: "abc" });

    request.mockResolvedValueOnce({ data: [{ email: "b@x.test" }] });
    const second = await callPage(z.object({ email: z.string() }), "organizations/o/members?limit=100", "abc");
    expect(request).toHaveBeenLastCalledWith("/api/local/control-plane/organizations/o/members?limit=100&cursor=abc");
    expect(second.nextCursor).toBeNull();
  });
});
