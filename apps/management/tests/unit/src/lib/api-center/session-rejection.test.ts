import { afterEach, describe, expect, it, vi } from "vitest";
import { localApiRequest, setManagementSessionToken, setSessionRejectedHandler } from "@/lib/api-center/client-core";

const unauthorized = () => new Response(JSON.stringify({ success: false, error: { code: "UNAUTHENTICATED" } }), { status: 401 });

describe("ending the session on a 401", () => {
  afterEach(() => {
    setManagementSessionToken(undefined);
    setSessionRejectedHandler(undefined);
    vi.unstubAllGlobals();
  });

  it("ends it when the token in use is rejected", async () => {
    const rejected = vi.fn();
    setSessionRejectedHandler(rejected);
    setManagementSessionToken("google-token");
    const fetchMock = vi.fn(async () => unauthorized());
    vi.stubGlobal("fetch", fetchMock);

    await expect(localApiRequest("/api/local/session")).rejects.toMatchObject({ status: 401 });

    expect(rejected).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/local/session", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer google-token" }) }));
  });

  it("keeps it when the 401 answers a request sent before sign-in finished", async () => {
    const rejected = vi.fn();
    setSessionRejectedHandler(rejected);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // Sign-in completes while this tokenless request is in flight.
        setManagementSessionToken("google-token");
        return unauthorized();
      }),
    );

    await expect(localApiRequest("/api/local/session")).rejects.toMatchObject({ status: 401 });

    expect(rejected).not.toHaveBeenCalled();
  });

  it("keeps it when the rejected token has since been replaced", async () => {
    const rejected = vi.fn();
    setSessionRejectedHandler(rejected);
    setManagementSessionToken("old-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        setManagementSessionToken("new-token");
        return unauthorized();
      }),
    );

    await expect(localApiRequest("/api/local/session")).rejects.toMatchObject({ status: 401 });

    expect(rejected).not.toHaveBeenCalled();
  });
});
