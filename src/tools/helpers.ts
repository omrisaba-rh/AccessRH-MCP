import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { tokenManager } from '../auth.js';
import { pendingAuth } from '../index.js';

const AUTH_TIMEOUT_MS = 10_000;

export async function requireAuth(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
): Promise<string> {
  const sessionId = extra.sessionId;
  if (!sessionId) {
    throw new Error(
      'Not authenticated. Call the "authenticate" tool first with your Red Hat offline token.',
    );
  }

  const pending = pendingAuth.get(sessionId);
  if (pending) {
    await Promise.race([
      pending,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Authentication timed out. Please try again.')), AUTH_TIMEOUT_MS),
      ),
    ]);
  }

  if (!tokenManager.hasSession(sessionId)) {
    throw new Error(
      'Not authenticated. Call the "authenticate" tool first with your Red Hat offline token.',
    );
  }
  return sessionId;
}

export function toolError(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], isError: true };
}
