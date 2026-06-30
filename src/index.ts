import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js';
import { tokenManager } from './auth.js';
import { registerCaseTools } from './tools/cases.js';
import { registerKnowledgeTools } from './tools/knowledge.js';
import type { Request, Response } from 'express';
import { SESSION_IDLE_TIMEOUT_MS, SESSION_REAP_INTERVAL_MS, MAX_SESSIONS } from './constants.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getValidatedSessionId(req: Request, res: Response): string | undefined | false {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && !UUID_RE.test(sessionId)) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid session ID format' },
      id: null,
    });
    return false;
  }
  return sessionId;
}

const SERVER_INSTRUCTIONS = `You are interacting with the Red Hat Customer Portal API.

## Authentication
- If a Bearer token is provided in the Authorization header at connect time, authentication is automatic.
- Otherwise, call the "authenticate" tool with a valid Red Hat offline token before using other tools.
- Offline tokens are generated at https://access.redhat.com/management/api
- The server automatically manages access token lifecycle (refresh before expiry).

## Case Management (api.access.redhat.com/support/v1)
- Cases are listed/filtered via POST /cases/filter — this is NOT a GET endpoint.
- Use offset and maxResults for pagination. Default page size is 50.
- Severity values: "1 (Urgent)", "2 (High)", "3 (Normal)", "4 (Low)".
- Status values: "Waiting on Red Hat", "Waiting on Customer", "Closed".
- To search for cases, always use list_cases with appropriate filters rather than fetching all cases.
- Attachments support up to 1GB via multipart form-data.
- When creating a case, product and version are required fields.
- To escalate a case, use the dedicated escalate_case tool.

## Knowledge Base
- Use search_solutions to find KB articles by keyword before creating a case.
- Use get_solution with the article ID to read full resolution steps.

## Error Handling
- 401/403: Token expired — auto-refreshed and retried automatically.
- 429: Rate limited — the server respects X-RateLimit-Delay and retries.
- 500: Server error — retried once after a 5-second delay.

## Best Practices
- Always paginate large result sets. Start with maxResults=50.
- Use date filters (startDate/endDate) to narrow results when looking for recent cases.
- When looking for a specific case, use get_case with the case number directly.
- For case updates, only specify the fields you want to change.
`;

function createServer(): McpServer {
  const server = new McpServer(
    { name: 'access-redhat', version: '1.0.0' },
    {
      capabilities: { logging: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.registerTool('authenticate', {
    title: 'Authenticate',
    description:
      'Authenticate with the Red Hat Customer Portal using an offline token. ' +
      'Not needed if a Bearer token was provided at connect time. ' +
      'Generate your offline token at https://access.redhat.com/management/api',
    inputSchema: {
      offline_token: z
        .string()
        .describe('Your Red Hat offline token from https://access.redhat.com/management/api'),
    },
  }, async ({ offline_token }, extra) => {
    const sessionId = extra.sessionId;
    if (!sessionId) {
      throw new Error('No session ID available. Ensure you are using Streamable HTTP transport.');
    }

    try {
      await tokenManager.authenticate(sessionId, offline_token);
      return {
        content: [{
          type: 'text',
          text: 'Successfully authenticated with Red Hat Customer Portal. You can now use all available tools.',
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Authentication failed: ${message}` }],
        isError: true,
      };
    }
  });

  registerCaseTools(server);
  registerKnowledgeTools(server);

  return server;
}

const PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000;
const HOST = process.env.MCP_HOST ?? '0.0.0.0';

const app = createMcpExpressApp({ host: HOST });
const transports = new Map<string, StreamableHTTPServerTransport>();
const sessionCreatedAt = new Map<string, number>();
let pendingSessionCount = 0;

app.post('/mcp', async (req, res) => {
  const sessionId = getValidatedSessionId(req, res);
  if (sessionId === false) return;

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      if (transports.size + pendingSessionCount >= MAX_SESSIONS) {
        res.status(503).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Server at capacity. Try again later.' },
          id: null,
        });
        return;
      }
      pendingSessionCount++;
      let sessionRegistered = false;
      try {
        const eventStore = new InMemoryEventStore();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          eventStore,
          onsessioninitialized: (newSessionId: string) => {
            transports.set(newSessionId, transport);
            sessionCreatedAt.set(newSessionId, Date.now());
            sessionRegistered = true;
            pendingSessionCount--;

            const authHeader = req.headers['authorization'];
            if (authHeader && authHeader.startsWith('Bearer ')) {
              const bearerToken = authHeader.slice(7);
              tokenManager
                .authenticate(newSessionId, bearerToken)
                .then(() => {
                  console.log(`New session: ${newSessionId.slice(0, 8)}… (auto-authenticated via bearer token)`);
                })
                .catch((err) => {
                  console.warn(
                    `New session: ${newSessionId.slice(0, 8)}… (bearer token validation failed: ${err instanceof Error ? err.message : err})`,
                  );
                });
            } else {
              console.log(`New session: ${newSessionId.slice(0, 8)}…`);
            }
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            tokenManager.clearSession(sid);
            transports.delete(sid);
            sessionCreatedAt.delete(sid);
            console.log(`Session closed: ${sid.slice(0, 8)}…`);
          }
        };

        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } catch (initError) {
        if (!sessionRegistered) {
          pendingSessionCount--;
        }
        throw initError;
      }
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.get('/mcp', async (req, res) => {
  const sessionId = getValidatedSessionId(req, res);
  if (sessionId === false) return;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  try {
    await transports.get(sessionId)!.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling SSE stream:', error);
    if (!res.headersSent) {
      res.status(500).send('Error establishing SSE stream');
    }
  }
});

app.delete('/mcp', async (req, res) => {
  const sessionId = getValidatedSessionId(req, res);
  if (sessionId === false) return;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  try {
    await transports.get(sessionId)!.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling session termination:', error);
    if (!res.headersSent) {
      res.status(500).send('Error processing session termination');
    }
  }
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    activeSessions: transports.size,
  });
});

const reapInterval = setInterval(async () => {
  const staleIds = tokenManager.getStaleSessionIds(SESSION_IDLE_TIMEOUT_MS);
  for (const sid of staleIds) {
    try {
      const transport = transports.get(sid);
      if (transport) {
        await transport.close();
      }
      tokenManager.clearSession(sid);
      transports.delete(sid);
      sessionCreatedAt.delete(sid);
      console.log(`Reaped idle session: ${sid.slice(0, 8)}…`);
    } catch (error) {
      console.error(`Error reaping session ${sid.slice(0, 8)}…:`, error);
    }
  }

  const cutoff = Date.now() - SESSION_IDLE_TIMEOUT_MS;
  for (const [sid, createdAt] of sessionCreatedAt) {
    if (!tokenManager.hasSession(sid) && createdAt < cutoff) {
      try {
        const transport = transports.get(sid);
        if (transport) {
          await transport.close();
        }
        transports.delete(sid);
        sessionCreatedAt.delete(sid);
        console.log(`Reaped unauthenticated session: ${sid.slice(0, 8)}…`);
      } catch (error) {
        console.error(`Error reaping unauthenticated session ${sid.slice(0, 8)}…:`, error);
      }
    }
  }
}, SESSION_REAP_INTERVAL_MS);
reapInterval.unref();

app.listen(PORT, () => {
  console.log(`Red Hat MCP Server listening on ${HOST}:${PORT}`);
  console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
  console.log(`Health check: http://${HOST}:${PORT}/health`);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  for (const [sessionId, transport] of transports) {
    try {
      await transport.close();
      transports.delete(sessionId);
    } catch (error) {
      console.error(`Error closing session ${sessionId.slice(0, 8)}…:`, error);
    }
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down...');
  for (const [sessionId, transport] of transports) {
    try {
      await transport.close();
      transports.delete(sessionId);
    } catch (error) {
      console.error(`Error closing session ${sessionId.slice(0, 8)}…:`, error);
    }
  }
  process.exit(0);
});
