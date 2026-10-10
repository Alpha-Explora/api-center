import {
  createOAuthAppAdminHandler,
  OAuthAdminSecretManager,
} from "../../../../apps/gauth/src/shared/oauth-app-admin";
import { MemoryOAuthAppStore } from "../../../../apps/gauth/src/shared/oauth-app-store";

function responseRecorder() {
  const result: { statusCode: number; body?: unknown; ended?: boolean } = {
    statusCode: 200,
  };
  const response = {
    status(code: number) {
      result.statusCode = code;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    },
    end() {
      result.ended = true;
      return response;
    },
  };
  return { response, result };
}

function fakeSecretManager() {
  const state: { value?: string; version: number; deleted: string[]; created: string[] } = {
    version: 0,
    deleted: [],
    created: [],
  };
  const client: OAuthAdminSecretManager = {
    async createSecret({ parent, secretId }) {
      state.created.push(`${parent}/secrets/${secretId}`);
      if (state.version) throw { code: 6 };
      return [{ name: "created" }];
    },
    async accessSecretVersion() {
      if (state.value === undefined) throw { code: 5 };
      return [
        {
          name: `projects/test-project/secrets/apic-gauth-sample-test/versions/${state.version}`,
          payload: { data: state.value },
        },
      ];
    },
    async addSecretVersion({ payload }) {
      state.value = payload.data.toString("utf8");
      state.version += 1;
      return [
        {
          name: `projects/test-project/secrets/apic-gauth-sample-test/versions/${state.version}`,
        },
      ];
    },
    async deleteSecret({ name }) {
      state.deleted.push(name);
      state.value = undefined;
    },
  };
  return { client, state };
}

function request(
  method: string,
  body?: unknown,
  token = "expected-admin-token",
) {
  return {
    method,
    params: { projectId: "sample", environment: "test" },
    body,
    headers: { "x-apicenter-gauth-admin-token": token },
    header: (name: string) =>
      name.toLowerCase() === "x-apicenter-gauth-admin-token"
        ? token
        : undefined,
  } as never;
}

const validInput = {
  redirectUris: [
    "https://sample.example/callback",
    "http://localhost:3000/callback",
  ],
  displayName: "Sample app",
  clientId: "sample-client",
  clientSecret: "secret-value",
};

describe("GAuth OAuth app admin handler", () => {
  it("uses the configured secret project before Google Cloud project fallbacks", async () => {
    const envNames = [
      "GAUTH_SECRETS_PROJECT_ID",
      "GOOGLE_CLOUD_PROJECT",
      "GCLOUD_PROJECT",
    ] as const;
    const originalEnv = Object.fromEntries(
      envNames.map((name) => [name, process.env[name]]),
    );
    const cases = [
      {
        configured: {
          GAUTH_SECRETS_PROJECT_ID: "isolated-secrets-project",
          GOOGLE_CLOUD_PROJECT: "runtime-project",
          GCLOUD_PROJECT: "legacy-project",
        },
        expectedProject: "isolated-secrets-project",
      },
      {
        configured: {
          GOOGLE_CLOUD_PROJECT: "runtime-project",
          GCLOUD_PROJECT: "legacy-project",
        },
        expectedProject: "runtime-project",
      },
      {
        configured: { GCLOUD_PROJECT: "legacy-project" },
        expectedProject: "legacy-project",
      },
    ];

    try {
      for (const { configured, expectedProject } of cases) {
        for (const name of envNames) delete process.env[name];
        Object.assign(process.env, configured);
        const secrets = fakeSecretManager();
        const handler = createOAuthAppAdminHandler({
          store: new MemoryOAuthAppStore(),
          expectedToken: "expected-admin-token",
          secretManager: secrets.client,
        });
        const put = responseRecorder();
        await handler(request("PUT", validInput), put.response as never);

        expect(put.result.statusCode).toBe(200);
        expect(secrets.state.created).toEqual([
          `projects/${expectedProject}/secrets/apic-gauth-sample-test`,
        ]);
      }
    } finally {
      for (const name of envNames) {
        const value = originalEnv[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("checks the admin token and validates the redirect URI limit and environment rules", async () => {
    const store = new MemoryOAuthAppStore();
    const handler = createOAuthAppAdminHandler({
      store,
      expectedToken: "expected-admin-token",
      cloudProjectId: "test-project",
    });
    const unauthorized = responseRecorder();
    await handler(
      request("GET", undefined, "wrong-token"),
      unauthorized.response as never,
    );
    expect(unauthorized.result.statusCode).toBe(401);

    for (const invalidBody of [
      {
        redirectUris: Array.from(
          { length: 11 },
          (_, index) => `https://sample.example/${index}`,
        ),
      },
      { redirectUris: ["http://sample.example/callback"] },
    ]) {
      const invalid = responseRecorder();
      await handler(request("PUT", invalidBody), invalid.response as never);
      expect(invalid.result.statusCode).toBe(400);
    }
    const allowedTestLocalhost = responseRecorder();
    await handler(
      request("PUT", { redirectUris: ["http://localhost/callback"] }),
      allowedTestLocalhost.response as never,
    );
    expect(allowedTestLocalhost.result.statusCode).toBe(200);
  });

  it("writes a secret version only when changed, never returns it, and deletes the secret with the app", async () => {
    const store = new MemoryOAuthAppStore();
    const secrets = fakeSecretManager();
    const handler = createOAuthAppAdminHandler({
      store,
      expectedToken: "expected-admin-token",
      cloudProjectId: "test-project",
      secretManager: secrets.client,
      now: () => new Date("2026-10-10T00:00:00.000Z"),
    });
    const put = responseRecorder();
    await handler(request("PUT", validInput), put.response as never);
    expect(put.result.statusCode).toBe(200);
    expect(secrets.state.version).toBe(1);

    const get = responseRecorder();
    await handler(request("GET"), get.response as never);
    expect(get.result.body).toMatchObject({
      hasOwnClient: true,
      clientId: "sample-client",
      secretLastChangedAt: "2026-10-10T00:00:00.000Z",
    });
    expect(get.result.body).not.toHaveProperty("clientSecret");

    const repeat = responseRecorder();
    await handler(request("PUT", validInput), repeat.response as never);
    expect(secrets.state.version).toBe(1);

    const deleted = responseRecorder();
    await handler(request("DELETE"), deleted.response as never);
    expect(deleted.result.statusCode).toBe(204);
    expect(secrets.state.deleted).toEqual([
      "projects/test-project/secrets/apic-gauth-sample-test",
    ]);
    await expect(
      store.findByProjectAndEnvironment("sample", "test"),
    ).resolves.toBeNull();
  });
});
