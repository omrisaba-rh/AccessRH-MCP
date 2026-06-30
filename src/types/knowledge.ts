import * as z from 'zod/v4';

export const SearchSolutionsInput = {
  query: z.string().describe('Search keywords (e.g. "kernel panic RHEL 9")'),
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
  product: z
    .string()
    .optional()
    .describe('Filter by Red Hat product (e.g. "Red Hat Enterprise Linux", "Red Hat OpenShift Container Platform"). Aliases like "RHEL", "OCP", "Ansible" are also accepted.'),
  documentType: z
    .enum(['Solution', 'Article'])
    .optional()
    .describe('Filter by document type'),
};

export const GetSolutionInput = {
  solutionId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, 'Solution ID must be alphanumeric')
    .describe('KCS solution/article ID (e.g. "6873281")'),
};
