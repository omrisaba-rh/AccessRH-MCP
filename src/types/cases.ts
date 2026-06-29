import * as z from 'zod/v4';
import { MAX_ATTACHMENT_BASE64_LENGTH } from '../constants.js';

const caseIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/, 'Case ID must be alphanumeric (no slashes or special characters)')
  .describe('Support case number (e.g. "03631543")');

export const ListCasesInput = {
  offset: z.number().int().min(0).optional().describe('Pagination offset (0-based)'),
  maxResults: z.number().int().min(1).max(500).optional().describe('Max results per page (default 50)'),
  startDate: z.string().optional().describe('Filter cases updated after this date (YYYY-MM-DD)'),
  endDate: z.string().optional().describe('Filter cases updated before this date (YYYY-MM-DD)'),
  severity: z
    .enum(['1 (Urgent)', '2 (High)', '3 (Normal)', '4 (Low)'])
    .optional()
    .describe('Case severity filter'),
  status: z
    .enum(['Waiting on Red Hat', 'Waiting on Customer', 'Closed'])
    .optional()
    .describe('Case status filter'),
  product: z.string().optional().describe('Red Hat product name (e.g. "Red Hat Enterprise Linux")'),
  owner: z.string().optional().describe('Case owner SSO username'),
  keyword: z.string().optional().describe('Keyword to search in case summary and description'),
  accountNumber: z.string().optional().describe('Account number to filter by'),
};

export const GetCaseInput = {
  caseId: caseIdSchema,
};

export const CreateCaseInput = {
  product: z.string().describe('Red Hat product name (e.g. "Red Hat Enterprise Linux")'),
  version: z.string().describe('Product version (e.g. "9.0")'),
  summary: z.string().describe('Brief summary of the issue'),
  description: z.string().describe('Detailed description of the issue'),
  severity: z
    .enum(['1 (Urgent)', '2 (High)', '3 (Normal)', '4 (Low)'])
    .optional()
    .describe('Case severity (default: "3 (Normal)")'),
};

export const UpdateCaseInput = {
  caseId: caseIdSchema,
  product: z.string().optional().describe('New product name'),
  version: z.string().optional().describe('New product version'),
  severity: z
    .enum(['1 (Urgent)', '2 (High)', '3 (Normal)', '4 (Low)'])
    .optional()
    .describe('New severity'),
  status: z
    .enum(['Waiting on Red Hat', 'Waiting on Customer', 'Closed'])
    .optional()
    .describe('New status'),
  summary: z.string().optional().describe('Updated summary'),
};

export const EscalateCaseInput = {
  caseId: caseIdSchema,
};

export const ListCaseCommentsInput = {
  caseId: caseIdSchema,
};

export const AddCaseCommentInput = {
  caseId: caseIdSchema,
  commentBody: z.string().describe('Comment text to add to the case'),
};

export const SearchCasesInput = {
  query: z.string().describe('Free-text search query across case summaries, descriptions, and comments'),
  rows: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Number of results to return (default 10, max 100)'),
  start: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Pagination offset (0-based, default 0)'),
};

export const ListCaseAttachmentsInput = {
  caseId: caseIdSchema,
};

export const AddCaseAttachmentInput = {
  caseId: caseIdSchema,
  fileName: z.string().describe('Name of the file to attach'),
  fileContent: z
    .string()
    .max(MAX_ATTACHMENT_BASE64_LENGTH, 'File content exceeds maximum allowed attachment size')
    .describe('Base64-encoded file content'),
  mimeType: z
    .string()
    .optional()
    .describe('MIME type of the file (default: application/octet-stream)'),
};
