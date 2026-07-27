import type { SmokeTestPreset } from "./smoke-test-presets";

export function groupSmokeTestsByService(smokeTests: SmokeTestPreset[]) {
  return smokeTests.reduce<Record<string, SmokeTestPreset[]>>((groups, test) => {
    groups[test.serviceId] = groups[test.serviceId] ?? [];
    groups[test.serviceId].push(test);
    return groups;
  }, {});
}

export function groupSmokeTestsByLabel(smokeTests: SmokeTestPreset[]) {
  return smokeTests.reduce<Record<string, SmokeTestPreset[]>>((groups, test) => {
    const group = test.group ?? "General";
    groups[group] = [...(groups[group] ?? []), test];
    return groups;
  }, {});
}

export function getPaymentSmokeTestGroups(smokeTests: SmokeTestPreset[]) {
  const order = [
    "Payment health",
    "Checkout session",
    "Subscription setup",
    "Subscription lifecycle",
    "Refund",
    "Webhook status",
  ];
  const groups = groupSmokeTestsByLabel(smokeTests.filter((test) => test.serviceId === "payment"));

  return order
    .filter((group) => groups[group]?.length)
    .map((group) => [group, groups[group]] as const);
}
