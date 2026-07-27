export type ActionConfirmationInput = {
  confirmationRequired: boolean;
  reasonRequired: boolean;
  expectedPhrase: string;
  typedPhrase?: string;
  reason?: string;
};

export type ActionConfirmationResult =
  | { valid: true }
  | {
      valid: false;
      error: string;
    };

export function validateActionConfirmation(
  input: ActionConfirmationInput,
): ActionConfirmationResult {
  if (input.confirmationRequired && input.typedPhrase !== input.expectedPhrase) {
    return {
      valid: false,
      error: `Type ${input.expectedPhrase} exactly to continue`,
    };
  }

  if (input.reasonRequired && !input.reason?.trim()) {
    return {
      valid: false,
      error: "Change reason is required",
    };
  }

  return { valid: true };
}
