export function getGoogleAuthorizationUrl(value?: string): string | undefined {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value) as {
      data?: { authorizationUrl?: unknown };
    };
    return typeof parsed.data?.authorizationUrl === "string"
      ? parsed.data.authorizationUrl
      : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeSmsTarget(input: string): { value: string; error?: string } {
  const compact = input.trim().replace(/[\s().-]/g, "");

  if (!compact) {
    return {
      value: "",
      error: "Enter an SMS target before running the SMS send check.",
    };
  }

  let value = compact;
  if (value.startsWith("00")) {
    value = `+${value.slice(2)}`;
  } else if (value.startsWith("09") && value.length === 11) {
    value = `+63${value.slice(1)}`;
  } else if (value.startsWith("9") && value.length === 10) {
    value = `+63${value}`;
  } else if (value.startsWith("63")) {
    value = `+${value}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    return {
      value,
      error:
        "Use E.164 format like +639171234567, or enter a PH mobile number like 09171234567.",
    };
  }

  return { value };
}
