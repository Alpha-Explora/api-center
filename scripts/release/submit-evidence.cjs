async function submitEvidence(
  { baseUrl, runnerToken, report },
  { request = fetch } = {},
) {
  if (!runnerToken) throw new Error("VERIFICATION_RUNNER_REQUIRED");
  const response = await request(
    new URL("/api/v1/admin/operations/verification", baseUrl),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + runnerToken,
      },
      body: JSON.stringify(report),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error("EVIDENCE_SUBMISSION_FAILED");
  return response.json();
}
module.exports = { submitEvidence };
