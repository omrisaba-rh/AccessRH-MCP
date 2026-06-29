import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiRequest } from '../http-client.js';
import { CASE_API_BASE, KCS_API_BASE, DEFAULT_PAGE_SIZE, DEFAULT_SEARCH_ROWS, MAX_ATTACHMENT_SIZE_BYTES, MAX_ATTACHMENT_BASE64_LENGTH } from '../constants.js';
import {
  ListCasesInput,
  GetCaseInput,
  CreateCaseInput,
  UpdateCaseInput,
  EscalateCaseInput,
  ListCaseCommentsInput,
  AddCaseCommentInput,
  SearchCasesInput,
  ListCaseAttachmentsInput,
  AddCaseAttachmentInput,
} from '../types/cases.js';
import { requireAuth } from './helpers.js';

export function registerCaseTools(server: McpServer): void {
  server.registerTool('list_cases', {
    title: 'List Support Cases',
    description:
      'List and filter Red Hat support cases. Uses POST with filter criteria. ' +
      'Supports pagination via offset/maxResults, date range filtering, and filtering by severity, status, product, or owner.',
    inputSchema: ListCasesInput,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args, extra) => {
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

    const result = await apiRequest({
      method: 'POST',
      path: '/cases/filter',
      baseUrl: CASE_API_BASE,
      sessionId,
      body,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('get_case', {
    title: 'Get Support Case',
    description: 'Get full details of a specific Red Hat support case by its case number.',
    inputSchema: GetCaseInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args, extra) => {
    const sessionId = requireAuth(extra);

    const result = await apiRequest({
      method: 'GET',
      path: `/cases/${args.caseId}`,
      baseUrl: CASE_API_BASE,
      sessionId,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('create_case', {
    title: 'Create Support Case',
    description:
      'Create a new Red Hat support case. Requires product, version, summary, and description. ' +
      'Severity defaults to "3 (Normal)" if not specified.',
    inputSchema: CreateCaseInput,
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async (args, extra) => {
    const sessionId = requireAuth(extra);

    const body: Record<string, unknown> = {
      product: args.product,
      version: args.version,
      summary: args.summary,
      description: args.description,
    };
    if (args.severity) body.severity = args.severity;

    const result = await apiRequest({
      method: 'POST',
      path: '/cases',
      baseUrl: CASE_API_BASE,
      sessionId,
      body,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('update_case', {
    title: 'Update Support Case',
    description:
      'Update an existing Red Hat support case. You can change product, version, severity, status, or summary.',
    inputSchema: UpdateCaseInput,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async (args, extra) => {
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

    const result = await apiRequest({
      method: 'PUT',
      path: `/cases/${caseId}`,
      baseUrl: CASE_API_BASE,
      sessionId,
      body,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('escalate_case', {
    title: 'Escalate Support Case',
    description:
      'Escalate a Red Hat support case for management attention. ' +
      'Use when a critical issue requires immediate escalation.',
    inputSchema: EscalateCaseInput,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async (args, extra) => {
    const sessionId = requireAuth(extra);

    const result = await apiRequest({
      method: 'PUT',
      path: `/cases/${args.caseId}`,
      baseUrl: CASE_API_BASE,
      sessionId,
      body: { requestManagementEscalation: true },
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('list_case_comments', {
    title: 'List Case Comments',
    description: 'Get all comments on a specific Red Hat support case.',
    inputSchema: ListCaseCommentsInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args, extra) => {
    const sessionId = requireAuth(extra);

    const result = await apiRequest({
      method: 'GET',
      path: `/cases/${args.caseId}/comments`,
      baseUrl: CASE_API_BASE,
      sessionId,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('add_case_comment', {
    title: 'Add Case Comment',
    description: 'Add a new comment to a Red Hat support case.',
    inputSchema: AddCaseCommentInput,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async (args, extra) => {
    const sessionId = requireAuth(extra);

    const result = await apiRequest({
      method: 'POST',
      path: `/cases/${args.caseId}/comments`,
      baseUrl: CASE_API_BASE,
      sessionId,
      body: { commentBody: args.commentBody },
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('search_cases', {
    title: 'Search Support Cases',
    description:
      'Full-text search across Red Hat support case summaries, descriptions, and comments. ' +
      'Use this for free-text queries. Use list_cases for structured filtering by severity, status, or date.',
    inputSchema: SearchCasesInput,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args, extra) => {
    const sessionId = requireAuth(extra);

    const params = new URLSearchParams({ q: args.query });
    params.set('rows', String(args.rows ?? DEFAULT_SEARCH_ROWS));
    if (args.start) params.set('start', String(args.start));

    const result = await apiRequest({
      method: 'GET',
      path: `/search/cases?${params.toString()}`,
      baseUrl: KCS_API_BASE,
      sessionId,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('list_case_attachments', {
    title: 'List Case Attachments',
    description: 'List all file attachments on a Red Hat support case.',
    inputSchema: ListCaseAttachmentsInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args, extra) => {
    const sessionId = requireAuth(extra);

    const result = await apiRequest({
      method: 'GET',
      path: `/cases/${args.caseId}/attachments`,
      baseUrl: CASE_API_BASE,
      sessionId,
    });

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('add_case_attachment', {
    title: 'Add Case Attachment',
    description:
      'Upload a file attachment to a Red Hat support case. ' +
      'The file content must be provided as a base64-encoded string. Supports files up to 1GB.',
    inputSchema: AddCaseAttachmentInput,
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async (args, extra) => {
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
  });
}
