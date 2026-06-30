import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiRequest } from '../http-client.js';
import { CASE_API_BASE, KCS_API_BASE, DEFAULT_PAGE_SIZE, DEFAULT_SEARCH_ROWS, MAX_ATTACHMENT_SIZE_BYTES, MAX_ATTACHMENT_BASE64_LENGTH } from '../constants.js';
import {
  ListCasesInput,
  GetCaseInput,
  CreateCaseInput,
  UpdateCaseInput,
  EscalateCaseInput,
  CloseCaseInput,
  ListCaseCommentsInput,
  AddCaseCommentInput,
  SearchCasesInput,
  ListCaseAttachmentsInput,
  AddCaseAttachmentInput,
} from '../types/cases.js';
import { requireAuth, toolError } from './helpers.js';

function shapeCaseSummary(c: any): Record<string, unknown> {
  return {
    caseNumber: c.caseNumber,
    summary: c.summary,
    status: c.status,
    severity: c.severity,
    product: c.product,
    version: c.version,
    createdDate: c.createdDate,
    lastModifiedDate: c.lastModifiedDate,
    owner: c.owner,
  };
}

function shapeCaseDetail(c: any): Record<string, unknown> {
  return {
    ...shapeCaseSummary(c),
    description: c.description,
    contactName: c.contactName,
    accountNumber: c.accountNumber,
  };
}

export function registerCaseTools(server: McpServer): void {
  server.registerTool('list_cases', {
    title: 'List Support Cases',
    description:
      'List Red Hat support cases using the official Case Management API. ' +
      'Best for structured filtering by severity, status, product, owner, date range, or account. ' +
      'Returns paginated results. Use search_cases instead for free-text keyword search.',
    inputSchema: ListCasesInput,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args, extra) => {
    try {
      const sessionId = requireAuth(extra);

      const body: Record<string, unknown> = {};
      if (args.offset !== undefined) body.offset = args.offset;
      body.maxResults = args.maxResults ?? DEFAULT_PAGE_SIZE;
      if (args.startDate) body.startDate = args.startDate;
      if (args.endDate) body.endDate = args.endDate;
      if (args.severity) body.severity = args.severity;
      if (args.status) body.status = args.status;
      if (args.product) body.product = args.product;
      if (args.owner) body.owner = args.owner;
      if (args.keyword) body.keyword = args.keyword;
      if (args.accountNumber) body.accountNumber = args.accountNumber;

      const result: any = await apiRequest({
        method: 'POST',
        path: '/cases/filter',
        baseUrl: CASE_API_BASE,
        sessionId,
        body,
      });

      const cases = Array.isArray(result?.case) ? result.case.map(shapeCaseSummary) : [];
      const shaped = { total: result?.count ?? cases.length, cases };

      return { content: [{ type: 'text', text: JSON.stringify(shaped) }] };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('get_case', {
    title: 'Get Support Case',
    description:
      'Get full details of a specific Red Hat support case by its case number. ' +
      'Set includeComments to true to also fetch comments in a single call.',
    inputSchema: GetCaseInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args, extra) => {
    try {
      const sessionId = requireAuth(extra);

      const casePromise = apiRequest({
        method: 'GET',
        path: `/cases/${args.caseId}`,
        baseUrl: CASE_API_BASE,
        sessionId,
      });

      if (args.includeComments) {
        const commentsPromise = apiRequest({
          method: 'GET',
          path: `/cases/${args.caseId}/comments`,
          baseUrl: CASE_API_BASE,
          sessionId,
        });

        const [caseResult, commentsResult]: any[] = await Promise.all([casePromise, commentsPromise]);
        const shaped = { ...shapeCaseDetail(caseResult), comments: commentsResult };
        return { content: [{ type: 'text', text: JSON.stringify(shaped) }] };
      }

      const result: any = await casePromise;
      return { content: [{ type: 'text', text: JSON.stringify(shapeCaseDetail(result)) }] };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('create_case', {
    title: 'Create Support Case',
    description:
      'Create a new Red Hat support case. IMPORTANT: Before creating a case, search the Knowledge Base ' +
      'with search_solutions to check for existing solutions. Requires product, version, summary, and description. ' +
      'Severity defaults to "3 (Normal)" if not specified.',
    inputSchema: CreateCaseInput,
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async (args, extra) => {
    try {
      const sessionId = requireAuth(extra);

      const body: Record<string, unknown> = {
        product: args.product,
        version: args.version,
        summary: args.summary,
        description: args.description,
      };
      if (args.severity) body.severity = args.severity;

      const result: any = await apiRequest({
        method: 'POST',
        path: '/cases',
        baseUrl: CASE_API_BASE,
        sessionId,
        body,
      });

      const shaped = { caseNumber: result?.caseNumber, summary: result?.summary };
      return { content: [{ type: 'text', text: `Case created: ${JSON.stringify(shaped)}` }] };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('update_case', {
    title: 'Update Support Case',
    description:
      'Update an existing Red Hat support case. You can change product, version, severity, status, or summary.',
    inputSchema: UpdateCaseInput,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async (args, extra) => {
    try {
      const sessionId = requireAuth(extra);

      const { caseId, ...updates } = args;
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) body[key] = value;
      }

      if (Object.keys(body).length === 0) {
        return {
          content: [{ type: 'text', text: 'No fields to update. Provide at least one field to change.' }],
          isError: true,
        };
      }

      await apiRequest({
        method: 'PUT',
        path: `/cases/${caseId}`,
        baseUrl: CASE_API_BASE,
        sessionId,
        body,
      });

      const fields = Object.keys(body).join(', ');
      return { content: [{ type: 'text', text: `Case ${caseId} updated successfully (${fields}).` }] };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('escalate_case', {
    title: 'Escalate Support Case',
    description:
      'Escalate a Red Hat support case for management attention. ' +
      'Use when a critical issue requires immediate escalation.',
    inputSchema: EscalateCaseInput,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async (args, extra) => {
    try {
      const sessionId = requireAuth(extra);

      await apiRequest({
        method: 'PUT',
        path: `/cases/${args.caseId}`,
        baseUrl: CASE_API_BASE,
        sessionId,
        body: { requestManagementEscalation: true },
      });

      return { content: [{ type: 'text', text: `Case ${args.caseId} escalated for management attention.` }] };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('close_case', {
    title: 'Close Support Case',
    description:
      'Close a Red Hat support case. Optionally add a resolution comment explaining how the issue was resolved.',
    inputSchema: CloseCaseInput,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async (args, extra) => {
    try {
      const sessionId = requireAuth(extra);

      await apiRequest({
        method: 'PUT',
        path: `/cases/${args.caseId}`,
        baseUrl: CASE_API_BASE,
        sessionId,
        body: { status: 'Closed' },
      });

      if (args.comment) {
        await apiRequest({
          method: 'POST',
          path: `/cases/${args.caseId}/comments`,
          baseUrl: CASE_API_BASE,
          sessionId,
          body: { commentBody: args.comment },
        });
      }

      return {
        content: [{ type: 'text', text: `Case ${args.caseId} closed successfully.` }],
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('list_case_comments', {
    title: 'List Case Comments',
    description: 'Get all comments on a specific Red Hat support case.',
    inputSchema: ListCaseCommentsInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args, extra) => {
    try {
      const sessionId = requireAuth(extra);

      const result = await apiRequest({
        method: 'GET',
        path: `/cases/${args.caseId}/comments`,
        baseUrl: CASE_API_BASE,
        sessionId,
      });

      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('add_case_comment', {
    title: 'Add Case Comment',
    description: 'Add a new comment to a Red Hat support case.',
    inputSchema: AddCaseCommentInput,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async (args, extra) => {
    try {
      const sessionId = requireAuth(extra);

      const result = await apiRequest({
        method: 'POST',
        path: `/cases/${args.caseId}/comments`,
        baseUrl: CASE_API_BASE,
        sessionId,
        body: { commentBody: args.commentBody },
      });

      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('search_cases', {
    title: 'Search Support Cases',
    description:
      'Full-text search across Red Hat support cases via the Hydra search index. ' +
      'Best for natural language queries, error messages, or keyword searches across summaries, descriptions, and comments. ' +
      'Use list_cases instead for structured filtering by severity, status, or date.',
    inputSchema: SearchCasesInput,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args, extra) => {
    try {
      const sessionId = requireAuth(extra);

      const params = new URLSearchParams({ q: args.query });
      params.set('rows', String(args.rows ?? DEFAULT_SEARCH_ROWS));
      if (args.start) params.set('start', String(args.start));

      const caseFields = 'case_number,case_summary,case_status,case_product,case_version,case_severity,case_owner,case_lastModifiedDate,case_createdDate';
      params.set('expression', `sort=case_lastModifiedDate desc&fl=${caseFields}`);

      const result: any = await apiRequest({
        method: 'GET',
        path: `/search/cases?${params.toString()}`,
        baseUrl: KCS_API_BASE,
        sessionId,
      });

      const docs = result?.response?.docs ?? [];
      const total = result?.response?.numFound ?? 0;
      const shaped = docs.map((doc: any) => ({
        caseNumber: doc.case_number,
        summary: doc.case_summary,
        status: doc.case_status,
        product: doc.case_product,
        version: doc.case_version,
        severity: doc.case_severity,
        owner: doc.case_owner,
        lastModified: doc.case_lastModifiedDate,
        created: doc.case_createdDate,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ total, results: shaped }) }],
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('list_case_attachments', {
    title: 'List Case Attachments',
    description: 'List all file attachments on a Red Hat support case.',
    inputSchema: ListCaseAttachmentsInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args, extra) => {
    try {
      const sessionId = requireAuth(extra);

      const result = await apiRequest({
        method: 'GET',
        path: `/cases/${args.caseId}/attachments`,
        baseUrl: CASE_API_BASE,
        sessionId,
      });

      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('add_case_attachment', {
    title: 'Add Case Attachment',
    description:
      'Upload a file attachment to a Red Hat support case. ' +
      'The file content must be provided as a base64-encoded string. Supports files up to 1GB.',
    inputSchema: AddCaseAttachmentInput,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async (args, extra) => {
    try {
      const sessionId = requireAuth(extra);

      if (args.fileContent.length > MAX_ATTACHMENT_BASE64_LENGTH) {
        const limitMB = (MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024).toFixed(0);
        return {
          content: [{ type: 'text', text: `File content exceeds maximum attachment size of ${limitMB}MB.` }],
          isError: true,
        };
      }
      const fileBuffer = Buffer.from(args.fileContent, 'base64');
      if (fileBuffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
        const sizeMB = (fileBuffer.length / 1024 / 1024).toFixed(1);
        const limitMB = (MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024).toFixed(0);
        return {
          content: [{ type: 'text', text: `File too large (${sizeMB}MB). Maximum attachment size is ${limitMB}MB.` }],
          isError: true,
        };
      }
      const blob = new Blob([fileBuffer], {
        type: args.mimeType ?? 'application/octet-stream',
      });

      const formData = new FormData();
      formData.append('file', blob, args.fileName);

      const result = await apiRequest({
        method: 'POST',
        path: `/cases/${args.caseId}/attachments`,
        baseUrl: CASE_API_BASE,
        sessionId,
        formData,
      });

      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return toolError(error);
    }
  });
}
