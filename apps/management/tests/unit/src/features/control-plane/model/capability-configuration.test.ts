import { describe, expect, it } from "vitest";
import {
  emailSenderBody,
  emailSenderFormSchema,
  gauthBody,
  gauthFormFrom,
  gauthFormSchema,
  isConfigurable,
  needsClientSecret,
  parseRedirectUris,
  redirectUriProblem,
  resetsToSharedClient,
  type GauthConfiguration,
  type GauthForm,
} from "@/features/control-plane/model/capability-configuration";
import { fieldErrors } from "@/features/control-plane/model/form-errors";

const ownClient: GauthConfiguration = {
  registered: true,
  credentialSettingsConfigured: true,
  status: "active",
  redirectUris: ["https://app.example.com/callback"],
  displayName: "Example",
  hasOwnClient: true,
  clientId: "123.apps.googleusercontent.com",
  secretLastChangedAt: "2026-11-01T00:00:00.000Z",
};

const form = (patch: Partial<GauthForm> = {}): GauthForm => ({
  redirectUris: "https://app.example.com/callback",
  displayName: "",
  clientMode: "shared",
  clientId: "",
  clientSecret: "",
  ...patch,
});

describe("configurable capabilities", () => {
  it("offers configuration only for email and Google sign-in", () => {
    expect(["email", "gauth", "payments", "sms", "otp", "geo"].filter(isConfigurable)).toEqual(["email", "gauth"]);
  });
});

describe("email sender", () => {
  it("sends an empty daily limit as unlimited and trims the address", () => {
    expect(emailSenderBody({ fromAddress: "  no-reply@example.com ", dailyLimit: "" })).toEqual({ fromAddress: "no-reply@example.com", dailyLimit: null });
    expect(emailSenderBody({ fromAddress: "no-reply@example.com", dailyLimit: " 500 " })).toEqual({ fromAddress: "no-reply@example.com", dailyLimit: 500 });
  });

  it("refuses what the email runtime refuses", () => {
    const errors = (fromAddress: string, dailyLimit = "") => fieldErrors(emailSenderFormSchema.safeParse({ fromAddress, dailyLimit }).error);
    expect(errors("")).toHaveProperty("fromAddress");
    expect(errors("a@example.com\r\nBcc: x@example.com")).toHaveProperty("fromAddress");
    expect(errors(`${"a".repeat(310)}@example.com`)).toHaveProperty("fromAddress");
    expect(errors("a@example.com", "0")).toHaveProperty("dailyLimit");
    expect(errors("a@example.com", "1.5")).toHaveProperty("dailyLimit");
    expect(errors("a@example.com", "-3")).toHaveProperty("dailyLimit");
    expect(errors("a@example.com", "99999999999999999999")).toHaveProperty("dailyLimit");
    expect(errors("a@example.com", "1")).toEqual({});
  });
});

describe("Google sign-in redirect URIs", () => {
  it("splits one URI per line, dropping blanks and repeats", () => {
    expect(parseRedirectUris(" https://a.example.com/cb \n\nhttps://a.example.com/cb\r\nhttps://b.example.com/cb")).toEqual([
      "https://a.example.com/cb",
      "https://b.example.com/cb",
    ]);
  });

  it("allows http://localhost only in test", () => {
    expect(redirectUriProblem("http://localhost:3000/cb", "test")).toBeNull();
    expect(redirectUriProblem("http://localhost:3000/cb", "live")).not.toBeNull();
    expect(redirectUriProblem("http://app.example.com/cb", "test")).not.toBeNull();
    expect(redirectUriProblem("https://app.example.com/cb", "live")).toBeNull();
  });

  it("refuses user info, fragments and non-URLs", () => {
    expect(redirectUriProblem("https://user:pass@app.example.com/cb", "test")).toMatch(/user name/);
    expect(redirectUriProblem("https://app.example.com/cb#done", "test")).toMatch(/fragment/);
    expect(redirectUriProblem("app.example.com/cb", "test")).toMatch(/valid URL/);
  });

  it("needs between 1 and 10 URIs", () => {
    const errors = (redirectUris: string) => fieldErrors(gauthFormSchema("test", undefined).safeParse(form({ redirectUris })).error);
    expect(errors("")).toHaveProperty("redirectUris");
    expect(errors(Array.from({ length: 11 }, (_, index) => `https://app.example.com/${index}`).join("\n"))).toHaveProperty("redirectUris");
    expect(errors(Array.from({ length: 10 }, (_, index) => `https://app.example.com/${index}`).join("\n"))).toEqual({});
  });
});

describe("Google sign-in client and secret", () => {
  it("needs a secret for a new or changed client ID, not for the stored one", () => {
    expect(needsClientSecret({ clientMode: "own", clientId: "new-id" }, undefined)).toBe(true);
    expect(needsClientSecret({ clientMode: "own", clientId: "other-id" }, ownClient)).toBe(true);
    expect(needsClientSecret({ clientMode: "own", clientId: ` ${ownClient.clientId} ` }, ownClient)).toBe(false);
    expect(needsClientSecret({ clientMode: "shared", clientId: "" }, ownClient)).toBe(false);

    const errors = (patch: Partial<GauthForm>) => fieldErrors(gauthFormSchema("test", ownClient).safeParse(form(patch)).error);
    expect(errors({ clientMode: "own", clientId: "other-id" })).toHaveProperty("clientSecret");
    expect(errors({ clientMode: "own", clientId: "" })).toHaveProperty("clientId");
    expect(errors({ clientMode: "own", clientId: ownClient.clientId ?? "" })).toEqual({});
  });

  it("clears an own client only when one is stored", () => {
    expect(gauthBody(form(), ownClient)).toEqual({ redirectUris: ["https://app.example.com/callback"], displayName: "", clientId: null });
    expect(gauthBody(form(), undefined)).toEqual({ redirectUris: ["https://app.example.com/callback"], displayName: "" });
    expect(resetsToSharedClient(form(), ownClient)).toBe(true);
    expect(resetsToSharedClient(form(), undefined)).toBe(false);
  });

  it("sends the secret only when typed", () => {
    expect(gauthBody(form({ clientMode: "own", clientId: " id-1 ", clientSecret: "s3cret", displayName: " Shop " }), undefined)).toEqual({
      redirectUris: ["https://app.example.com/callback"],
      displayName: "Shop",
      clientId: "id-1",
      clientSecret: "s3cret",
    });
    expect(gauthBody(form({ clientMode: "own", clientId: ownClient.clientId ?? "" }), ownClient)).not.toHaveProperty("clientSecret");
  });

  it("starts the form from the stored settings, never with a secret", () => {
    expect(gauthFormFrom(ownClient)).toEqual({
      redirectUris: "https://app.example.com/callback",
      displayName: "Example",
      clientMode: "own",
      clientId: ownClient.clientId,
      clientSecret: "",
    });
    expect(gauthFormFrom(undefined).clientMode).toBe("shared");
  });
});
