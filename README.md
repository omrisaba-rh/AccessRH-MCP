# Red Hat Customer Portal MCP Server

An MCP (Model Context Protocol) server that provides access to the [Red Hat Customer Portal API](https://access.redhat.com) via Streamable HTTP transport. Supports multi-user sessions with per-session OAuth token management.

## Features

- **Case Management** — List, create, update, close, and escalate Red Hat support cases; manage comments and attachments
- **Knowledge Base Search** — Search Red Hat KCS articles and solutions with product/document type filtering; retrieve structured content (environment, issue, root cause, resolution)
- **Multi-User Sessions** — Each HTTP session gets isolated authentication and token state
- **Automatic Token Refresh** — Offline tokens are exchanged for short-lived access tokens, refreshed automatically before expiry
- **Smart Error Handling** — Automatic retry on rate limits (429), token expiry (401/403), and server errors (500); all tools return structured `isError` responses
- **Security Hardened** — In-memory AES-256-GCM encryption of offline tokens, log redaction, UUID-validated session IDs
- **Optimized for LLMs** — Response shaping returns only essential fields to minimize token consumption; Hydra Solr expressions for server-side field selection
- **Containerized** — Ships with a multi-stage Dockerfile for lightweight production deployment

## Prerequisites

- Node.js 22+
- A Red Hat Customer Portal account
- An offline token generated at https://access.redhat.com/management/api

## Quick Start

### Local

```bash
npm install
npm run build
npm start
```

The server starts on `http://0.0.0.0:3000/mcp` by default.

### Docker

```bash
docker build -t access-rh-mcp .
docker run -p 3000:3000 access-rh-mcp
```

### Environment Variables

| Variable   | Default   | Description                    |
|------------|-----------|--------------------------------|
| `MCP_PORT` | `3000`    | Port the server listens on     |
| `MCP_HOST` | `0.0.0.0` | Host address to bind to        |

## Authentication Flow

1. Client connects to the MCP server via Streamable HTTP
2. Client calls the `authenticate` tool with their Red Hat offline token
3. Server exchanges the offline token for a short-lived access token via Red Hat SSO
4. All subsequent tool calls in the same session use the cached access token
5. The server automatically refreshes the access token before it expires

```
Client                    MCP Server                 Red Hat SSO
  │                          │                           │
  ├─ POST /mcp (init) ─────►│                           │
  │◄── session established ──┤                           │
  │                          │                           │
  ├─ authenticate(token) ───►│                           │
  │                          ├─ POST /token (refresh) ──►│
  │                          │◄── access_token ──────────┤
  │◄── authenticated ────────┤                           │
  │                          │                           │
  ├─ list_cases(filters) ───►│                           │
  │                          ├─ POST /cases/filter ─────►│ (api.access.redhat.com)
  │◄── cases data ───────────┤                           │
```

## Available Tools

### `authenticate`

Must be called first in every session.

| Parameter       | Required | Description                                    |
|-----------------|----------|------------------------------------------------|
| `offline_token` | Yes      | Your Red Hat offline token                     |

### `list_cases`

List Red Hat support cases using the official Case Management API. Best for structured filtering by severity, status, product, owner, date range, or account. Use `search_cases` for free-text keyword search.

| Parameter       | Required | Description                                    |
|-----------------|----------|------------------------------------------------|
| `offset`        | No       | Pagination offset (0-based)                    |
| `maxResults`    | No       | Max results per page (default 50)              |
| `startDate`     | No       | Filter by start date (YYYY-MM-DD)              |
| `endDate`       | No       | Filter by end date (YYYY-MM-DD)                |
| `severity`      | No       | 1 (Urgent), 2 (High), 3 (Normal), 4 (Low)     |
| `status`        | No       | Waiting on Red Hat, Waiting on Customer, Closed|
| `product`       | No       | Red Hat product name                           |
| `owner`         | No       | Case owner SSO username                        |
| `keyword`       | No       | Search keyword                                 |
| `accountNumber` | No       | Account number filter                          |

### `search_cases`

Full-text search across Red Hat support cases via the Hydra search index. Best for natural language queries, error messages, or keyword searches. Use `list_cases` for structured filtering.

| Parameter | Required | Description                                |
|-----------|----------|--------------------------------------------|
| `query`   | Yes      | Free-text search query                     |
| `rows`    | No       | Number of results (default 10, max 100)    |
| `start`   | No       | Pagination offset (default 0)              |

### `get_case`

Get full details of a specific case. Set `includeComments` to fetch comments in the same call.

| Parameter         | Required | Description                                |
|-------------------|----------|--------------------------------------------|
| `caseId`          | Yes      | Support case number                        |
| `includeComments` | No       | Also fetch and include comments (default: false) |

### `create_case`

Create a new support case. Search the Knowledge Base with `search_solutions` first to check for existing solutions.

| Parameter     | Required | Description                      |
|---------------|----------|----------------------------------|
| `product`     | Yes      | Red Hat product name             |
| `version`     | Yes      | Product version                  |
| `summary`     | Yes      | Brief issue summary              |
| `description` | Yes      | Detailed issue description       |
| `severity`    | No       | Severity level (default Normal)  |

### `update_case`

Update an existing case.

| Parameter  | Required | Description             |
|------------|----------|-------------------------|
| `caseId`   | Yes      | Case number to update   |
| `product`  | No       | New product name        |
| `version`  | No       | New product version     |
| `severity` | No       | New severity            |
| `status`   | No       | New status              |
| `summary`  | No       | Updated summary         |

### `escalate_case`

Escalate a case for management attention.

| Parameter | Required | Description           |
|-----------|----------|-----------------------|
| `caseId`  | Yes      | Case number to escalate|

### `close_case`

Close a support case with an optional resolution comment.

| Parameter | Required | Description                                      |
|-----------|----------|--------------------------------------------------|
| `caseId`  | Yes      | Case number to close                             |
| `comment` | No       | Optional closing comment explaining the resolution |

### `list_case_comments`

Get all comments on a case.

| Parameter | Required | Description        |
|-----------|----------|--------------------|
| `caseId`  | Yes      | Support case number|

### `add_case_comment`

Add a comment to a case.

| Parameter     | Required | Description        |
|---------------|----------|--------------------|
| `caseId`      | Yes      | Support case number|
| `commentBody` | Yes      | Comment text       |

### `list_case_attachments`

List all file attachments on a case.

| Parameter | Required | Description        |
|-----------|----------|--------------------|
| `caseId`  | Yes      | Support case number|

### `add_case_attachment`

Upload a file attachment to a case (up to 1GB).

| Parameter     | Required | Description                       |
|---------------|----------|-----------------------------------|
| `caseId`      | Yes      | Support case number               |
| `fileName`    | Yes      | Name of the file                  |
| `fileContent` | Yes      | Base64-encoded file content       |
| `mimeType`    | No       | MIME type (default: octet-stream) |

### `search_solutions`

Search the Red Hat Knowledge Base for solutions and articles by keyword. Supports filtering by product and document type. Product aliases like "RHEL", "OCP", "Ansible" are resolved automatically.

| Parameter      | Required | Description                                        |
|----------------|----------|----------------------------------------------------|
| `query`        | Yes      | Search keywords (e.g. "kernel panic RHEL 9")       |
| `rows`         | No       | Number of results (default 10, max 100)            |
| `start`        | No       | Pagination offset (default 0)                      |
| `product`      | No       | Filter by Red Hat product (e.g. "RHEL", "OCP")     |
| `documentType` | No       | Filter by type: "Solution" or "Article"            |

### `get_solution`

Get the full content of a Knowledge Base article by its ID. Returns structured fields: title, environment, issue, root cause, resolution, and diagnostic steps.

| Parameter    | Required | Description                          |
|--------------|----------|--------------------------------------|
| `solutionId` | Yes      | KCS solution/article ID (e.g. "6873281") |

## MCP Client Configuration

### Cursor

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "access-redhat": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Endpoints

| Endpoint  | Method | Description                           |
|-----------|--------|---------------------------------------|
| `/mcp`    | POST   | MCP JSON-RPC endpoint                 |
| `/mcp`    | GET    | SSE stream for server notifications   |
| `/mcp`    | DELETE | Session termination                   |
| `/health` | GET    | Health check with active session count|

## Future Domains

The following API domains will be added in future releases:

- **Subscription Management** (`/management/v1`) — Subscriptions, systems, allocations, errata, packages, images
- **Account Management** (`/account/v1`) — Users, organizations, permissions
