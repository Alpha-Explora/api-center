import { afterEach, describe, expect, it, vi } from "vitest";
import { localApiRequest, setSessionRejectedHandler, setSignedIn } from "@/lib/api-center/client-core";

const unauthorized = () => new Response(JSON.stringify({ success: false, error: { code: "UNAUTHENTICATED" } }), { status: 401 });

describe("ending the session on a 401", () => {
  afterEach(() => {
    setSignedIn(false);
    setSessionRejectedHandler(undefined);
    vi.unstubAllGlobals();
  });

  it("ends it when the session in use is rejected", async () => {
    const rejected = vi.fn();
    setSessionRejectedHandler(rejected);
    setSignedIn(true);
    vi.stubGlobal("fetch", vi.fn(async () => unauthorized()));

    await expect(localApiRequest("/api/local/session")).rejects.toMatchObject({ status: 401 });

    expect(rejected).toHaveBeenCalledOnce();
  });

  it("keeps it when the 401 answers a request sent before sign-in finished", async () => {
    const rejected = vi.fn();
    setSessionRejectedHandler(rejected);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // Sign-in completes while this request, sent signed out, is in flight.
        setSignedIn(true);
        return unauthorized();
      }),
    );

    await expect(localApiRequest("/api/local/session")).rejects.toMatchObject({ status: 401 });

    expect(rejected).not.toHaveBeenCalled();
  });

  it("keeps it when the session has since been replaced", async () => {
    const rejected = vi.fn();
    setSessionRejectedHandler(rejected);
    setSignedIn(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // Signed out and back in while the request was in flight.
        setSignedIn(false);
        setSignedIn(true);
        return unauthorized();
      }),
    );

    await expect(localApiRequest("/api/local/session")).rejects.toMatchObject({ status: 401 });

    expect(rejected).not.toHaveBeenCalled();
  });
});
