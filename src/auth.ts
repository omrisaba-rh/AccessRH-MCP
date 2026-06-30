import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { SSO_TOKEN_URL, SSO_CLIENT_ID, TOKEN_REFRESH_BUFFER_MS, SSO_REQUEST_TIMEOUT_MS } from './constants.js';

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = randomBytes(32);

interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

function encrypt(plaintext: string): EncryptedBlob {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decrypt(blob: EncryptedBlob): string {
  const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, blob.iv);
  decipher.setAuthTag(blob.tag);
  return decipher.update(blob.ciphertext) + decipher.final('utf8');
}

interface TokenEntry {
  encryptedOfflineToken: EncryptedBlob;
  accessToken: string;
  expiresAt: number;
  lastActivity: number;
}

interface SSOExchangeResult {
  accessToken: string;
  expiresInMs: number;
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
    const result = await this.exchangeToken(offlineToken);

    this.sessions.set(sessionId, {
      encryptedOfflineToken: encrypt(offlineToken),
      accessToken: result.accessToken,
      expiresAt: Date.now() + result.expiresInMs,
      lastActivity: Date.now(),
    });

    return result.accessToken;
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

    const refreshPromise = this.refreshSession(sessionId).finally(() => {
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

  private async refreshSession(sessionId: string): Promise<string> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      throw new Error('Session not found during token refresh.');
    }

    const offlineToken = decrypt(entry.encryptedOfflineToken);
    const result = await this.exchangeToken(offlineToken);

    if (!this.sessions.has(sessionId)) {
      return result.accessToken;
    }

    entry.accessToken = result.accessToken;
    entry.expiresAt = Date.now() + result.expiresInMs;
    entry.lastActivity = Date.now();

    return result.accessToken;
  }

  private async exchangeToken(offlineToken: string): Promise<SSOExchangeResult> {
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
      console.error(`SSO token exchange failed (${response.status})`);
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
    return {
      accessToken: data.access_token,
      expiresInMs: data.expires_in * 1000,
    };
  }
}

export const tokenManager = new TokenManager();
