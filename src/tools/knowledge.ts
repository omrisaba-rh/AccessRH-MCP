import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiRequest } from '../http-client.js';
import { KCS_API_BASE } from '../constants.js';
import { SearchSolutionsInput, GetSolutionInput } from '../types/knowledge.js';
import { requireAuth, toolError } from './helpers.js';

const DEFAULT_SEARCH_ROWS = 10;

const PRODUCT_ALIASES: Record<string, string> = {
  'OCP': 'Red Hat OpenShift Container Platform',
  'OpenShift': 'Red Hat OpenShift Container Platform',
  'RHEL': 'Red Hat Enterprise Linux',
  'Ansible': 'Red Hat Ansible Automation Platform',
  'AAP': 'Red Hat Ansible Automation Platform',
  'Satellite': 'Red Hat Satellite',
  'SSO': 'Red Hat Single Sign-On',
  'Keycloak': 'Red Hat build of Keycloak',
  'ACM': 'Red Hat Advanced Cluster Management for Kubernetes',
  'ACS': 'Red Hat Advanced Cluster Security for Kubernetes',
  'Ceph': 'Red Hat Ceph Storage',
};

function resolveProduct(input: string): string {
  return PRODUCT_ALIASES[input] ?? input;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildKcsExpression(opts: {
  product?: string;
  documentType?: string;
}): string {
  const docKind = opts.documentType
    ? `documentKind:("${opts.documentType}")`
    : 'documentKind:("Article" OR "Solution")';

  let fq = `${docKind} AND accessState:("active" OR "private")`;
  if (opts.product) {
    fq += ` AND product:("${resolveProduct(opts.product)}")`;
  }

  const fl = 'id,allTitle,documentKind,view_uri,lastModifiedDate,score';
  return `sort=score DESC&fq=${fq}&fl=${fl}&showRetired=false`;
}

export function registerKnowledgeTools(server: McpServer): void {
  server.registerTool('search_solutions', {
    title: 'Search Knowledge Base',
    description:
      'Search the Red Hat Knowledge Base for solutions and articles by keyword. ' +
      'Returns matching article IDs, titles, and URLs. Use get_solution to read full content.',
    inputSchema: SearchSolutionsInput,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args, extra) => {
    try {
      const sessionId = await requireAuth(extra);

      const params = new URLSearchParams({ q: args.query });
      params.set('rows', String(args.rows ?? DEFAULT_SEARCH_ROWS));
      if (args.start) params.set('start', String(args.start));

      const expression = buildKcsExpression({
        product: args.product,
        documentType: args.documentType,
      });
      params.set('expression', expression);

      const result: any = await apiRequest({
        method: 'GET',
        path: `/search/kcs?${params.toString()}`,
        baseUrl: KCS_API_BASE,
        sessionId,
      });

      const docs = result?.response?.docs ?? [];
      const total = result?.response?.numFound ?? 0;
      const shaped = docs.map((doc: any) => ({
        id: doc.id,
        title: doc.allTitle,
        type: doc.documentKind,
        url: doc.view_uri,
        lastModified: doc.lastModifiedDate,
        score: doc.score,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ total, results: shaped }) }],
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('get_solution', {
    title: 'Get KB Solution',
    description:
      'Get the full content of a Red Hat Knowledge Base article by its ID. ' +
      'Returns structured fields: title, environment, issue, root cause, resolution, and diagnostic steps.',
    inputSchema: GetSolutionInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args, extra) => {
    try {
      const sessionId = await requireAuth(extra);

      const fl = 'id,allTitle,solution_resolution,solution_environment,solution_root_cause,solution_issue,solution_diagnostic_steps,view_uri';
      const params = new URLSearchParams({
        q: `id:${args.solutionId}`,
        rows: '1',
        expression: `fl=${fl}`,
      });

      const result: any = await apiRequest({
        method: 'GET',
        path: `/search/kcs?${params.toString()}`,
        baseUrl: KCS_API_BASE,
        sessionId,
      });

      const doc = result?.response?.docs?.[0];
      if (!doc) {
        return {
          content: [{ type: 'text', text: `No article found with ID "${args.solutionId}".` }],
          isError: true,
        };
      }

      const shaped = {
        id: doc.id,
        title: doc.allTitle,
        url: doc.view_uri,
        environment: doc.solution_environment ? stripHtml(doc.solution_environment) : undefined,
        issue: doc.solution_issue ? stripHtml(doc.solution_issue) : undefined,
        rootCause: doc.solution_root_cause ? stripHtml(doc.solution_root_cause) : undefined,
        resolution: doc.solution_resolution ? stripHtml(doc.solution_resolution) : undefined,
        diagnosticSteps: doc.solution_diagnostic_steps ? stripHtml(doc.solution_diagnostic_steps) : undefined,
      };

      return { content: [{ type: 'text', text: JSON.stringify(shaped) }] };
    } catch (error) {
      return toolError(error);
    }
  });
}
