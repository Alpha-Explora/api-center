import crypto from 'node:crypto';
import { OtpCode } from '../../domain/entities/OtpCode';
import { OtpId } from '../../domain/value-objects/OtpId';
import { OtpTarget } from '../../domain/value-objects/OtpTarget';
import { OtpRepository } from '../../domain/repositories/OtpRepository';

export interface GenerateOtpInput {
  target: string;
  channel: 'sms' | 'email';
  length?: number;
  expiresInSeconds?: number;
}

export interface GenerateOtpResult {
  otpId: string;
  expiresAt: string;
  channel: 'sms' | 'email';
  target: string;
  code?: string;
}

export class GenerateOtpUseCase {
  constructor(private readonly otpRepository: OtpRepository) {}

  async execute(input: GenerateOtpInput): Promise<GenerateOtpResult> {
    const targetVo = new OtpTarget(input.target, input.channel);
    const resolvedLength = Math.max(4, Math.min(10, Number(input.length) || 6));
    const resolvedExpiry = Math.max(60, Math.min(3600, Number(input.expiresInSeconds) || 300));
    
    const max = Math.pow(10, resolvedLength);
    const generatedCode = String(crypto.randomInt(0, max)).padStart(resolvedLength, '0');
    const otpId = new OtpId();
    const expiresAtMs = Date.now() + resolvedExpiry * 1000;

    const otpEntity = new OtpCode({
      id: otpId,
      target: targetVo,
      code: generatedCode,
      expiresAt: expiresAtMs,
      status: 'pending',
    });

    await this.otpRepository.save(otpEntity);

    return {
      otpId: otpId.getValue(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      channel: targetVo.getChannel(),
      target: targetVo.getValue(),
      ...(process.env.NODE_ENV !== 'production' && { code: generatedCode }),
    };
  }
}
