import crypto from 'node:crypto';
import type { OtpGenerateRequest, OtpGenerateResponse } from '@alpha-explora/apicenter-contracts';
import { OtpTarget } from './generate-otp.model';
import { createOtpRepository } from '../../shared/otp-store';
import type { OtpRepositoryInterface } from '../../shared/otp-repository.interface';
import { sendResendEmail, sendTwilioSms, type SharedServiceCaller } from '@apicenter/runtime';
import { hashOtpCode } from '../../shared/otp-hash';
import { renderOtpMessage, resolveOtpPolicy } from '../../shared/project-settings';

export class GenerateOtpService {
  constructor(private readonly store: OtpRepositoryInterface = createOtpRepository()) {}

  async execute(input: OtpGenerateRequest & { recipient?: string; target?: string; digits?: number; ttlSeconds?: number }, owner: SharedServiceCaller): Promise<OtpGenerateResponse & { target: string; code?: string }> {
    const rawTarget = input.recipient || input.target;
    const targetVo = new OtpTarget(rawTarget!, input.channel);

    const settings = await this.store.getProjectSettings(owner.projectId, owner.environment);
    const policy = resolveOtpPolicy(input, settings);

    const code = String(crypto.randomInt(0, Math.pow(10, policy.digits))).padStart(policy.digits, '0');
    const otpId = `otp_${crypto.randomUUID().replace(/-/g, '')}`;
    const expiresAt = Date.now() + policy.ttlSeconds * 1000;
    const message = renderOtpMessage(policy.template, code, policy.ttlSeconds);

    await this.store.save({
      otpId,
      target: targetVo.getTarget(),
      channel: targetVo.getChannel(),
      codeHash: hashOtpCode(otpId, code),
      expiresAt,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: policy.maxAttempts,
    }, owner);

    const mock = process.env.OTP_DELIVERY_MODE === 'mock' && process.env.NODE_ENV !== 'production';
    try {
      if (!mock && targetVo.getChannel() === 'sms') {
        await sendTwilioSms({ to: targetVo.getTarget(), message });
      } else if (!mock) {
        await sendResendEmail({
          to: targetVo.getTarget(),
          subject: 'Your APICenter verification code',
          text: message,
        });
      }
    } catch (error) {
      await this.store.update(otpId, { status: 'expired' }, owner);
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
