const { GoogleAuth } = require("google-auth-library");
const { z } = require("zod");
const deploymentTarget = z
  .object({
    service: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
    serviceId: z
      .string()
      .regex(/^[a-z0-9-]{1,150}$/)
      .optional(),
    project: z.string().regex(/^[a-z][a-z0-9-]{4,62}$/),
    region: z.string().regex(/^[a-z]+-[a-z]+[0-9]$/),
    expectedCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
  })
  .strict();
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
async function observeDeployment(
  input,
  {
    request = async (url) =>
      (await auth.request({ url, timeout: 10_000 })).data,
  } = {},
) {
  const target = deploymentTarget.parse(input);
  const base = `https://${target.region}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${target.project}`;
  const service = await request(`${base}/services/${target.service}`);
  const revision = service.status?.latestReadyRevisionName;
  if (typeof revision !== "string" || !/^[a-z0-9-]+$/.test(revision))
    throw new Error("DEPLOYMENT_IDENTITY_MISSING");
  if (
    service.status.traffic?.length !== 1 ||
    service.status.traffic[0].percent !== 100 ||
    service.status.traffic[0].revisionName !== revision
  )
    throw new Error("DEPLOYMENT_TRAFFIC_AMBIGUOUS");
  const value = await request(`${base}/revisions/${revision}`);
  const digest = value.status?.imageDigest;
  const commit = value.spec?.containers?.[0]?.env?.find(
    (item) => item.name === "APICENTER_RELEASE_SHA",
  )?.value;
  if (
    typeof digest !== "string" ||
    !/@sha256:[a-f0-9]{64}$/.test(digest) ||
    typeof commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(commit)
  )
    throw new Error("DEPLOYMENT_IDENTITY_MISSING");
  const production =
    value.spec?.containers?.[0]?.env?.some(
      (item) => item.name === "NODE_ENV" && item.value === "production",
    ) === true;
  return {
    service: target.service,
    ...(target.serviceId ? { serviceId: target.serviceId } : {}),
    revision,
    commit,
    imageDigest: digest,
    production,
  };
}
module.exports = { observeDeployment, deploymentTarget };
