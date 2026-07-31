import type { GauthVerifyTokenRequest, GauthVerifyTokenResponse } from '@apicenter/contracts';

export class VerifyTokenService {
  execute(input: GauthVerifyTokenRequest): GauthVerifyTokenResponse {
    if (!input.idToken) {
      throw { status: 400, code: 'INVALID_REQUEST', message: 'idToken is required.' };
    }

    return {
      valid: true,
      userId: 'google_user_mock_123',
      email: 'dev@alphaexplora.com',
      emailVerified: true,
      name: 'Developer Account',
    };
  }
}
