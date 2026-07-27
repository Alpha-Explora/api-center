import { toast } from "sonner";
import { copyTextToClipboard } from "@/lib/client-clipboard";

export function showMutationError(
  title: string,
  description = "Check the service configuration and try again.",
) {
  return (error: unknown) => {
    toast.error(title, { description: getErrorMessage(error) ?? description });
  };
}

export function generateRandomSecret() {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function copyText(
  value: string,
  successMessage: string,
  label: string,
  setManualCopy: (manualCopy: { label: string; value: string } | null) => void,
) {
  let copied = false;

  try {
    copied = await copyTextToClipboard(value);
  } catch {
    copied = false;
  }

  if (copied) {
    setManualCopy(null);
    toast.success(successMessage);
    return;
  }

  setManualCopy({ label, value });
  toast.error("Copy was blocked", {
    description: "Select the displayed value and copy it manually.",
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : undefined;
}
