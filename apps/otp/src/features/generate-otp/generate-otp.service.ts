import crypto from 'node:crypto';
import type { OtpGenerateRequest, OtpGenerateResponse } from '@apicenter/contracts';
import { OtpTarget } from './generate-otp.model';
import { createOtpRepository } from '../../shared/otp-store';
import type { OtpRepositoryInterface } from '../../shared/otp-repository.interface';
import { sendResendEmail, sendTwilioSms } from '@apicenter/runtime';
import { hashOtpCode } from '../../shared/otp-hash';

export class GenerateOtpService {
  constructor(private readonly store: OtpRepositoryInterface = createOtpRepository()) {}

  async execute(input: OtpGenerateRequest & { recipient?: string; target?: string; digits?: number; ttlSeconds?: number }): Promise<OtpGenerateResponse & { target: string; code?: string }> {
    const rawTarget = input.recipient || input.target;
    const targetVo = new OtpTarget(rawTarget!, input.channel);

    const resolvedLength = Math.max(4, Math.min(10, Number(input.digits) || 6));
    const resolvedExpiry = Math.max(60, Math.min(3600, Number(input.ttlSeconds) || 300));
    
    const max = Math.pow(10, resolvedLength);
    const code = String(crypto.randomInt(0, max)).padStart(resolvedLength, '0');
    const otpId = `otp_${crypto.randomUUID().replace(/-/g, '')}`;
    const expiresAt = Date.now() + resolvedExpiry * 1000;

    await this.store.save({
      otpId,
      target: targetVo.getTarget(),
      channel: targetVo.getChannel(),
      codeHash: hashOtpCode(otpId, code),
      expiresAt,
      status: 'pending',
    });

    const mock = process.env.OTP_DELIVERY_MODE === 'mock' && process.env.NODE_ENV !== 'production';
    try {
      if (!mock && targetVo.getChannel() === 'sms') {
        await sendTwilioSms({ to: targetVo.getTarget(), message: `Your APICenter verification code is ${code}` });
      } else if (!mock) {
        await sendResendEmail({
          to: targetVo.getTarget(),
          subject: 'Your APICenter verification code',
          text: `Your APICenter verification code is ${code}`,
        });
      }
    } catch (error) {
      await this.store.update(otpId, { status: 'expired' });
      throw error;
    }

    return {
      otpId,
      expiresAt: new Date(expiresAt).toISOString(),
      channel: targetVo.getChannel(),
      recipient: targetVo.getTarget(),
      target: targetVo.getTarget(),
      ...(mock && { code }),
    };
  }
}
