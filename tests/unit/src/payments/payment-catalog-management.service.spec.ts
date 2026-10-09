import axios from "axios";
import { PaymentCatalogManagementService } from "../../../../apps/gateway/src/domains/payments/features/catalog-management/payment-catalog-management.service";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("PaymentCatalogManagementService", () => {
  const saved = {
    url: process.env.APICENTER_PAYMENTS_URL,
    token: process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST,
  };

  beforeAll(() => {
    process.env.APICENTER_PAYMENTS_URL = "http://payments.test";
    process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST = "catalog-test-token";
  });

  afterAll(() => {
    if (saved.url === undefined) delete process.env.APICENTER_PAYMENTS_URL; else process.env.APICENTER_PAYMENTS_URL = saved.url;
    if (saved.token === undefined) delete process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST;
    else process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST = saved.token;
  });

  // Stands in for the registry: alphaci-core is a project in tribe alphaci.
  const tenancy = {
    resolveProject: jest.fn((projectId: string) => (projectId === "alphaci-core"
      ? { tribe: { tribeId: "alphaci" }, project: { projectId: "alphaci-core" } }
      : null)),
  };
  const input = { ownerTribeId: "alphaci", projectId: "alphaci-core", environment: "test", name: "Starter plan" };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({
      status: 201,
      data: { success: true, data: { productId: "prod_1", name: "Starter plan", active: true } },
    } as any);
  });

  it("sends the project the admin named to the payments runtime", async () => {
    const service = new PaymentCatalogManagementService(tenancy as any);
    await service.createProduct(input);

    const config = mockedAxios.post.mock.calls[0][2] as { headers: Record<string, string> };
    expect(config.headers).toEqual(expect.objectContaining({
      "X-APICenter-Owner-Tribe-ID": "alphaci",
      "X-APICenter-Project-ID": "alphaci-core",
    }));
  });

  it("refuses a project outside the owner tribe before calling the runtime", async () => {
    const service = new PaymentCatalogManagementService(tenancy as any);
    await expect(service.createProduct({ ...input, projectId: "other-core" })).rejects.toMatchObject({ status: 400 });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

