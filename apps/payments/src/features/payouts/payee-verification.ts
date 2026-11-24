import { z } from 'zod';

export const payeeVerificationInput = z.object({
  verifiedBy: z.string().trim().min(1).max(200),
  verifiedAt: z.iso.datetime({ offset: true }),
  method: z.enum(['government_id', 'in_person', 'third_party', 'other']),
  reference: z.string().trim().min(1).max(120).nullable().optional(),
}).strict();

export type PayeeVerification = Omit<z.infer<typeof payeeVerificationInput>, 'reference'> & { reference: string | null };

export function requiresPayeeVerification(): boolean {
  return process.env.PAYOUTS_REQUIRE_PAYEE_VERIFICATION === 'true';
}
