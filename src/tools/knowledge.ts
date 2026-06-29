import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiRequest } from '../http-client.js';
import { KCS_API_BASE } from '../constants.js';
import { SearchSolutionsInput, GetSolutionInput } from '../types/knowledge.js';
import { requireAuth } from './helpers.js';

const DEFAULT_SEARCH_ROWS = 10;

export function registerKnowledgeTools(server: McpServer): void {
  server.registerTool('search_solutions', {
    title: 'Search Knowledge Base',
    description:
      'Search the Red Hat Knowledge Base for solutions and articles by keyword. ' +
      'Returns matching article IDs, titles, and URLs. Use get_solution to read full content.',
    inputSchema: SearchSolutionsInput,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args, extra) => {
    const sessionId = requireAuth(extra);

    const params = new URLSearchParams({ q: args.query });
    params.set('rows', String(args.rows ?? DEFAULT_SEARCH_ROWS));
    if (args.start) params.set('start', String(args.start));

    const result = await apiRequest({
      method: 'GET',
      path: `/search/kcs?${params.toString()}`,
      baseUrl: KCS_API_BASE,
      sessionId,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('get_solution', {
    title: 'Get KB Solution',
    description:
      'Get the full content of a Red Hat Knowledge Base article by its ID. ' +
      'Returns structured fields: title, environment, issue, root cause, resolution, and diagnostic steps.',
    inputSchema: GetSolutionInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args, extra) => {
    const sessionId = requireAuth(extra);

    const result = await apiRequest({
      method: 'GET',
      path: `/search/kcs?q=id:${args.solutionId}&rows=1`,
      baseUrl: KCS_API_BASE,
      sessionId,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });
}
