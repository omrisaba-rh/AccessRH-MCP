import { SSO_TOKEN_URL, SSO_CLIENT_ID, TOKEN_REFRESH_BUFFER_MS, SSO_REQUEST_TIMEOUT_MS } from './constants.js';

interface TokenEntry {
  offlineToken: string;
  accessToken: string;
  expiresAt: number;
  lastActivity: number;
}

interface SSOTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
}

export class TokenManager {
  private sessions = new Map<string, TokenEntry>();
  private refreshInFlight = new Map<string, Promise<string>>();

  async authenticate(sessionId: string, offlineToken: string): Promise<string> {
    return this.fetchAccessToken(offlineToken, sessionId, true);
  }

  async getAccessToken(sessionId: string): Promise<string> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      throw new Error(
        'Session not authenticated. Call the "authenticate" tool first with your Red Hat offline token.',
      );
    }

    entry.lastActivity = Date.now();
    if (entry.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return entry.accessToken;
    }

    const existing = this.refreshInFlight.get(sessionId);
    if (existing) {
      return existing;
    }

    const refreshPromise = this.fetchAccessToken(entry.offlineToken, sessionId, false).finally(() => {
      this.refreshInFlight.delete(sessionId);
    });
    this.refreshInFlight.set(sessionId, refreshPromise);
    return refreshPromise;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  invalidateAccessToken(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.accessToken = '';
      entry.expiresAt = 0;
    }
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.refreshInFlight.delete(sessionId);
  }

  getStaleSessionIds(maxIdleMs: number): string[] {
    const cutoff = Date.now() - maxIdleMs;
    const stale: string[] = [];
    for (const [id, entry] of this.sessions) {
      if (entry.lastActivity < cutoff) {
        stale.push(id);
      }
    }
    return stale;
  }

  private async fetchAccessToken(offlineToken: string, sessionId: string, isInitialAuth: boolean): Promise<string> {
    const response = await fetch(SSO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: SSO_CLIENT_ID,
        refresh_token: offlineToken,
      }),
      signal: AbortSignal.timeout(SSO_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`SSO token exchange failed (${response.status}): ${body}`);
      if (response.status === 400 || response.status === 401) {
        throw new Error(
          `Authentication failed (${response.status}). Your offline token may be invalid or expired. ` +
            'Generate a new one at https://access.redhat.com/management/api',
        );
      }
      throw new Error(
        `SSO token exchange failed with status ${response.status}. Try again later.`,
      );
    }

    const data = (await response.json()) as SSOTokenResponse;

    if (!isInitialAuth && !this.sessions.has(sessionId)) {
      return data.access_token;
    }

    this.sessions.set(sessionId, {
      offlineToken,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      lastActivity: Date.now(),
    });

    return data.access_token;
  }

}

export const tokenManager = new TokenManager();
