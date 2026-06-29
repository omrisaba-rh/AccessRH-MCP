export const SSO_TOKEN_URL =
  'https://sso.redhat.com/auth/realms/redhat-external/protocol/openid-connect/token';

export const SSO_CLIENT_ID = 'rhsm-api';

export const CASE_API_BASE = 'https://api.access.redhat.com/support/v1';
export const KCS_API_BASE = 'https://access.redhat.com/hydra/rest';
export const MGMT_API_BASE = 'https://api.access.redhat.com/management/v1';
export const ACCT_API_BASE = 'https://api.access.redhat.com/account/v1';

export const TOKEN_REFRESH_BUFFER_MS = 60_000;

export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_SEARCH_ROWS = 10;

export const MAX_RETRIES = 1;
export const RATE_LIMIT_DEFAULT_DELAY_MS = 5_000;
export const SERVER_ERROR_RETRY_DELAY_MS = 5_000;

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const SESSION_REAP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

export const API_REQUEST_TIMEOUT_MS = 60_000; // 60 seconds per API call
export const SSO_REQUEST_TIMEOUT_MS = 15_000; // 15 seconds for SSO token exchange

export const MAX_SESSIONS = 100;

export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_ATTACHMENT_BASE64_LENGTH = Math.ceil(MAX_ATTACHMENT_SIZE_BYTES / 3) * 4 + 4; // base64 overhead + padding
