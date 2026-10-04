import { createHmac } from 'node:crypto';

/** HMAC-hashes an OTP code with its record ID so stored records never contain plaintext codes. */
export function hashOtpCode(otpId: string, code: string): string {
  const secret = process.env.OTP_HASH_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('OTP_HASH_SECRET is required in production');
  }
  return createHmac('sha256', secret || 'development-only-otp-secret')
    .update(`${otpId}:${code}`).digest('hex');
}
