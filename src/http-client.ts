import { tokenManager } from './auth.js';
import {
  MAX_RETRIES,
  RATE_LIMIT_DEFAULT_DELAY_MS,
  SERVER_ERROR_RETRY_DELAY_MS,
  API_REQUEST_TIMEOUT_MS,
} from './constants.js';

export interface ApiRequestOptions {
  method?: string;
  path: string;
  baseUrl: string;
  sessionId: string;
  body?: unknown;
  headers?: Record<string, string>;
  formData?: FormData;
}

export interface ApiError {
  status: number;
  message: string;
  retryable: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiRequest<T = unknown>(options: ApiRequestOptions): Promise<T> {
  const { method = 'GET', path, baseUrl, sessionId, body, headers = {}, formData } = options;

  const url = `${baseUrl}${path}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const accessToken = await tokenManager.getAccessToken(sessionId);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    };

    if (body && !formData) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const requestInit: RequestInit = {
      method,
      headers: requestHeaders,
      body: formData ?? (body ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
    };

    const response = await fetch(url, requestInit);

    if (response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }
      const text = await response.text();
      return text as unknown as T;
    }

    if ((response.status === 401 || response.status === 403) && attempt < MAX_RETRIES) {
      tokenManager.invalidateAccessToken(sessionId);
      continue;
    }

    if (response.status === 429) {
      const delayHeader = response.headers.get('X-RateLimit-Delay');
      const delayMs = delayHeader
        ? parseInt(delayHeader, 10) * 1000
        : RATE_LIMIT_DEFAULT_DELAY_MS;

      if (attempt < MAX_RETRIES) {
        await sleep(delayMs);
        continue;
      }

      throw new Error(
        `Rate limited by Red Hat API. Retry after ${delayMs / 1000}s. ` +
          'Reduce request frequency.',
      );
    }

    if (response.status >= 500 && attempt < MAX_RETRIES) {
      await sleep(SERVER_ERROR_RETRY_DELAY_MS);
      continue;
    }

    console.error(`Red Hat API error ${response.status} on ${method} ${path}`);
    throw new Error(sanitizeApiError(response.status, method, path));
  }

  throw new Error('Maximum retry attempts exceeded');
}

function sanitizeApiError(status: number, method: string, path: string): string {
  switch (status) {
    case 400:
      return `Bad request on ${method} ${path}. Check the parameters and try again.`;
    case 401:
    case 403:
      return `Authorization failed on ${method} ${path}. Your token may have expired. Try re-authenticating.`;
    case 404:
      return `Resource not found: ${method} ${path}. Verify the case number or resource ID.`;
    case 409:
      return `Conflict on ${method} ${path}. The resource may have been modified. Retry with fresh data.`;
    default:
      if (status >= 500) {
        return `Red Hat server error (${status}) on ${method} ${path}. Try again later.`;
      }
      return `Request failed with status ${status} on ${method} ${path}.`;
  }
}
