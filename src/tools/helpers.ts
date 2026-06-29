import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { tokenManager } from '../auth.js';

export function requireAuth(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
): string {
  const sessionId = extra.sessionId;
  if (!sessionId || !tokenManager.hasSession(sessionId)) {
    throw new Error(
      'Not authenticated. Call the "authenticate" tool first with your Red Hat offline token.',
    );
  }
  return sessionId;
}
