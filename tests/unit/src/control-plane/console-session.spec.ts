import { generateKeyPairSync } from "node:crypto";
import { issueSessionToken, sessionKeyFrom, SESSION_TTL_SECONDS, verifySessionToken } from "../../../../apps/management/src/lib/server/console-session";
import { loadConsoleSessionKeys, verifyConsoleSession } from "../../../../apps/gateway/src/domains/control-plane/console-session.verifier";
import { ConsoleActorGuard, type ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import type { ScopedAdminGuard } from "../../../../apps/gateway/src/domains/auth-security/auth/guards/scoped-admin.guard";
import type { ConfigService } from "../../../../apps/gateway/src/config/config.service";

function keyPair(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateJwk: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid }),
    publicJwk: { ...publicKey.export({ format: "jwk" }), kid },
  };
}

const primary = keyPair("console-2026-11");
const other = keyPair("console-other");
const consoleKey = sessionKeyFrom(primary.privateJwk)!;
const gatewayKeys = loadConsoleSessionKeys(JSON.stringify([primary.publicJwk]));
const issuedAt = Date.parse("2026-11-21T00:00:00Z");
const identity = { subject: "google-sub-1", email: "amgo.it@alphaexplora.com", name: "Amgo" };

describe("console session, issued by the console and verified by the gateway", () => {
  it("names the person for the gateway", () => {
    const token = issueSessionToken(consoleKey, identity, issuedAt);
    expect(verifyConsoleSession(token, gatewayKeys, issuedAt + 60_000)).toEqual({ email: identity.email, subject: identity.subject, name: "Amgo" });
    expect(verifySessionToken(consoleKey, token, issuedAt + 60_000)).toMatchObject({ email: identity.email, subject: identity.subject });
  });

  it("lasts a working day and no longer", () => {
    const token = issueSessionToken(consoleKey, identity, issuedAt);
    const justBefore = issuedAt + (SESSION_TTL_SECONDS - 60) * 1000;
    const after = issuedAt + (SESSION_TTL_SECONDS + 60) * 1000;
    expect(verifyConsoleSession(token, gatewayKeys, justBefore).email).toBe(identity.email);
    expect(() => verifyConsoleSession(token, gatewayKeys, after)).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => verifySessionToken(consoleKey, token, after)).toThrow("expired");
  });

  it("refuses a session signed with another key or altered after signing", () => {
    const foreign = issueSessionToken(sessionKeyFrom(other.privateJwk)!, identity, issuedAt);
    expect(() => verifyConsoleSession(foreign, gatewayKeys, issuedAt)).toThrow(expect.objectContaining({ status: 401 }));

    const [header, payload, signature] = issueSessionToken(consoleKey, identity, issuedAt).split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, email: "abtorres.it@alphaexplora.com" })).toString("base64url");
    expect(() => verifyConsoleSession(`${header}.${forged}.${signature}`, gatewayKeys, issuedAt)).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => verifyConsoleSession("not-a-token", gatewayKeys, issuedAt)).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("is refused when the gateway has no keys, and a private key is never accepted as a public one", () => {
    const token = issueSessionToken(consoleKey, identity, issuedAt);
    expect(() => verifyConsoleSession(token, loadConsoleSessionKeys(undefined), issuedAt)).toThrow(expect.objectContaining({ status: 503 }));
    expect(() => loadConsoleSessionKeys(JSON.stringify([JSON.parse(primary.privateJwk)]))).toThrow("private key material");
  });
});

describe("ConsoleActorGuard with a console session", () => {
  const saved = process.env.MANAGEMENT_SESSION_PUBLIC_KEYS;
  afterAll(() => {
    if (saved === undefined) delete process.env.MANAGEMENT_SESSION_PUBLIC_KEYS;
    else process.env.MANAGEMENT_SESSION_PUBLIC_KEYS = saved;
  });

  function guardWith(headers: Record<string, string>) {
    process.env.MANAGEMENT_SESSION_PUBLIC_KEYS = JSON.stringify([primary.publicJwk]);
    const platform = { canActivate: jest.fn().mockResolvedValue(true) } as unknown as ScopedAdminGuard;
    const config = { platformAdminEmails: ["abtorres.it@alphaexplora.com"] } as unknown as ConfigService;
    const googleVerifier = jest.fn();
    const guard = new ConsoleActorGuard(platform, config, googleVerifier);
    const request = { headers } as unknown as ConsoleRequest;
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as never;
    return { guard, request, context, googleVerifier };
  }

  it("acts as the member the session names, without asking Google", async () => {
    const token = issueSessionToken(consoleKey, identity);
    const { guard, request, context, googleVerifier } = guardWith({ "x-apicenter-user-session": token });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.consoleActor).toEqual({ kind: "member", email: identity.email, subject: identity.subject, platformAdmin: false, name: "Amgo" });
    expect(googleVerifier).not.toHaveBeenCalled();
  });

  it("refuses an invalid session instead of falling back to the platform", async () => {
    const { guard, request, context } = guardWith({ "x-apicenter-user-session": "forged" });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 401 });
    expect(request.consoleActor).toBeUndefined();
  });
});
