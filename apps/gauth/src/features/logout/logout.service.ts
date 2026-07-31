import { callGoogleProvider } from '../../shared/google-provider';

const googleRevokeUrl = process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke';

export class LogoutService {
  async execute(payload: any) {
    const token = payload.token || payload.refreshToken || payload.idTokenHint;

    if (!token) {
      throw { status: 400, code: 'INVALID_LOGOUT_REQUEST', message: 'token, refreshToken, or idTokenHint is required.' };
    }

    const response = await callGoogleProvider('logout', `${googleRevokeUrl}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!response.ok) {
      throw { status: 502, code: 'GOOGLE_LOGOUT_FAILED', message: 'Google token revocation failed.' };
    }

    return { success: true };
  }
}
