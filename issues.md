# Issues Found and Fixed

## Issue 1: Cross-session token leakage via shared `'pending'` key [SECURITY - CRITICAL]

**Category:** User Security and Privacy

`authenticate()` accepted a `sessionId` parameter but never forwarded it to `fetchAccessToken()`. Tokens were stored under a shared `'pending'` key and later promoted via `promotePendingSession()`. If two users called `authenticate` concurrently, User B's token could overwrite `'pending'` before User A's promote ran, giving User A access to User B's Red Hat account.

**Fix:** Pass `sessionId` directly to `fetchAccessToken()` so each session's token is stored under its own key atomically. Removed the `promotePendingSession` pattern entirely.

**Files changed:** `src/auth.ts`, `src/index.ts`

---

## Issue 2: 401/403 retry destroys the offline token, making retry always fail [SECURITY / RELIABILITY]

**Category:** User Security and Privacy, Scale/Performance

When the HTTP client received a 401/403, it called `tokenManager.clearSession(sessionId)` which deleted the entire `TokenEntry` -- including the `offlineToken` needed to fetch a new access token. On the next retry iteration, `getAccessToken()` found no entry and threw "Session not authenticated" instead of refreshing the token. The retry path was completely broken.

**Fix:** Added `invalidateAccessToken()` method that zeros out only the `accessToken` and `expiresAt` fields while preserving the `offlineToken`. The retry loop now calls this instead of `clearSession()`, so the next `getAccessToken()` detects the expired token and re-fetches using the stored offline token.

**Files changed:** `src/auth.ts`, `src/http-client.ts`

---

## Issue 3: Abandoned sessions leak memory indefinitely [SCALE / PERFORMANCE]

**Category:** Scale/Performance

Sessions were only cleaned up when a client sent an explicit DELETE request (triggering `transport.onclose`). If a client disconnected without sending DELETE (network drop, browser close, crash), the session's `StreamableHTTPServerTransport`, `InMemoryEventStore`, and `TokenEntry` remained in memory forever. With dozens of users over time, this causes unbounded memory growth.

**Fix:** Added `lastActivity` timestamp to `TokenEntry`, updated on every `getAccessToken()` call. Added a periodic reaper (every 5 minutes) that finds sessions idle for more than 30 minutes, closes their transports, and removes them from both the transport map and token manager. The interval uses `unref()` to not block process exit.

**Files changed:** `src/auth.ts`, `src/constants.ts`, `src/index.ts`

---

## Issue 4: Pretty-printed JSON responses waste LLM tokens [TOKEN EFFICIENCY]

**Category:** Token Efficiency

All 8 case management tools used `JSON.stringify(result, null, 2)` to format API responses. The 2-space indentation adds thousands of whitespace characters (newlines, spaces) to every response. For a typical `list_cases` response with 50 cases, this can add 30-40% overhead in token count. LLMs parse JSON equally well regardless of formatting, so this whitespace provides zero value while inflating costs.

**Fix:** Changed all tool responses to use `JSON.stringify(result)` (compact form) across all 8 tools in `cases.ts`.

**Files changed:** `src/tools/cases.ts`

---

## Issue 5: URL path traversal via unsanitized `caseId` [SECURITY]

**Category:** User Security and Privacy

The `caseId` parameter in all case tools was a bare `z.string()` with no validation. A value like `../../management/v1/subscriptions` would be interpolated into the URL path and normalized by `fetch` to reach an entirely different API endpoint (`/management/v1/subscriptions`). This bypasses the server's tool-level access control, allowing access to subscription or account APIs that the MCP server intentionally does not expose.

**Fix:** Created a shared `caseIdSchema` with a regex constraint (`/^[a-zA-Z0-9_-]+$/`) that rejects slashes, dots, and any special characters. Applied it to all 6 schemas that accept a `caseId` parameter. Zod validates the input before the tool handler runs.

**Files changed:** `src/types/cases.ts`

---

## Issue 6: Concurrent token refresh floods Red Hat SSO [SCALE / PERFORMANCE]

**Category:** Scale/Performance

When a session's access token expires, `getAccessToken()` calls `fetchAccessToken()` -- but with no deduplication. If a user sends 5 parallel tool calls and the token has just expired, all 5 concurrently enter the refresh path, sending 5 independent HTTP POST requests to Red Hat SSO for the exact same session. With dozens of active users, this multiplies the problem and risks hitting SSO rate limits (429 errors on the SSO endpoint itself).

**Fix:** Added a `refreshInFlight` map (`Map<sessionId, Promise>`) to `TokenManager`. When a refresh is needed, the first caller stores its promise in the map. Subsequent callers for the same session await the existing promise instead of starting a new SSO request. The promise is cleared from the map in a `.finally()` block.

**Files changed:** `src/auth.ts`

---

## Issue 7: No request timeout on Red Hat API calls [SCALE / PERFORMANCE]

**Category:** Scale/Performance

`fetch()` calls to the Red Hat API in `http-client.ts` had no timeout. If the Red Hat API hangs (network issue, API outage, DNS stall), the fetch blocks indefinitely. The tool call never completes, the session sits in limbo, and resources are consumed with no recovery path. The session reaper can't help because `lastActivity` was already updated by `getAccessToken()` at the start of the request, making the session look active.

**Fix:** Added `API_REQUEST_TIMEOUT_MS = 60000` (60 seconds) to constants. Every `fetch()` call now includes `signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS)`. The timeout applies per attempt in the retry loop, so each retry gets a fresh 60-second window.

**Files changed:** `src/http-client.ts`, `src/constants.ts`

---

## Issue 8: Raw API error bodies leaked to LLM context [SECURITY / PRIVACY]

**Category:** User Security and Privacy, Token Efficiency

When a Red Hat API call failed, the raw HTTP response body was included in the error message: `throw new Error(\`Red Hat API error ${status}: ${errorBody}\`)`. This error propagated through the MCP SDK back to the LLM client. Red Hat API error responses can contain account numbers, organization IDs, user identifiers, and internal server details. Exposing these in the LLM conversation context creates a privacy risk and wastes tokens on irrelevant diagnostic data.

**Fix:** Raw error bodies are now logged server-side via `console.error` for operator debugging. The error thrown to the LLM uses a `sanitizeApiError()` function that returns a generic, safe message based only on the HTTP status code, method, and path -- no response body content.

**Files changed:** `src/http-client.ts`

---

## Issue 9: SSO error body leaked to LLM via `authenticate` tool [SECURITY / PRIVACY]

**Category:** User Security and Privacy

Issue 8 sanitized errors from `http-client.ts`, but the SSO token exchange in `auth.ts` was missed. On non-400/401 SSO failures (e.g. 500, 502), the raw SSO response body was included in the thrown error: `SSO token exchange failed: ${status} ${body}`. The `authenticate` tool caught this and returned the full message to the LLM, potentially exposing Red Hat SSO internal details.

**Fix:** The raw SSO response body is now logged server-side via `console.error`. The error thrown to the LLM contains only the HTTP status code and a generic "try again later" message, with no response body content.

**Files changed:** `src/auth.ts`

---

## Issue 10: Unauthenticated sessions never reaped, causing memory leak [SCALE / PERFORMANCE]

**Category:** Scale/Performance

The session reaper (Issue 3 fix) called `tokenManager.getStaleSessionIds()` which only knows about sessions that called `authenticate`. If a client connected (creating a `StreamableHTTPServerTransport` and `InMemoryEventStore` in the `transports` map) but never called `authenticate` and never sent DELETE, the transport and event store leaked forever. The reaper had no way to discover these orphaned sessions.

**Fix:** Added a `sessionCreatedAt` map that records the creation timestamp of every transport. The reaper now has a second pass that finds transport entries with no matching `tokenManager` session that have been idle past the timeout. These orphaned transports are closed and removed. The `sessionCreatedAt` map is also cleaned up in the `onclose` handler and during reaping.

**Files changed:** `src/index.ts`

---

## Issue 11: No cap on concurrent sessions, resource exhaustion possible [SCALE / PERFORMANCE]

**Category:** Scale/Performance

Every MCP init request unconditionally created a new transport, `InMemoryEventStore`, and `McpServer` with all tools registered. There was no limit on how many sessions could exist. A misbehaving client or attack could open hundreds or thousands of sessions, exhausting server memory. Each session allocates non-trivial resources (event store for resumability, tool registrations, transport buffers).

**Fix:** Added `MAX_SESSIONS = 100` constant. The POST handler checks `Object.keys(transports).length` before creating a new session and returns `503 Service Unavailable` when the limit is reached. The session reaper (Issues 3 and 10) frees slots over time.

**Files changed:** `src/index.ts`, `src/constants.ts`

---

## Issue 12: SSO token exchange has no timeout, blocks indefinitely [SCALE / PERFORMANCE]

**Category:** Scale/Performance

Issue 7 added `AbortSignal.timeout()` to Red Hat API calls in `http-client.ts`, but the SSO `fetch` call in `auth.ts:fetchAccessToken` was not updated. If Red Hat SSO hangs (DNS stall, network partition, SSO outage), the token exchange blocks indefinitely. With the Bug 6 fix (refresh dedup), all parallel tool calls for that session share the same in-flight promise, meaning a single hung SSO request blocks ALL concurrent tool calls for the session with no recovery.

**Fix:** Added `SSO_REQUEST_TIMEOUT_MS = 15000` (15 seconds) constant and applied `AbortSignal.timeout(SSO_REQUEST_TIMEOUT_MS)` to the SSO fetch call. On timeout, the promise rejects with an AbortError, the `refreshInFlight` cleanup runs via `.finally()`, and callers can retry on the next request.

**Files changed:** `src/auth.ts`, `src/constants.ts`

---

## Issue 13: In-flight SSO refresh resurrects cleared sessions with valid tokens [SECURITY / SCALE]

**Category:** User Security and Privacy, Scale/Performance

`clearSession()` deleted the session from the `sessions` map but did not cancel or remove the corresponding entry in `refreshInFlight`. If a token refresh was in-flight when the session was cleared (reaper or client disconnect), `fetchAccessToken()` would resolve and call `this.sessions.set(sessionId, ...)`, resurrecting the deleted session with a fresh `accessToken` and `lastActivity` timestamp. The zombie entry held valid Red Hat credentials in memory with no transport to use them, and the reaper wouldn't find it for another 30 minutes (fresh `lastActivity`).

**Fix:** `clearSession()` now also deletes from `refreshInFlight`. `fetchAccessToken()` takes an `isInitialAuth` flag; on refresh (not initial auth), it checks `this.sessions.has(sessionId)` before writing and skips the write if the session was cleared during the fetch.

**Files changed:** `src/auth.ts`

---

## Issue 14: GET /mcp SSE handler has no error handling, breaks error consistency [SCALE / PERFORMANCE]

**Category:** Scale/Performance

The POST handler (line 148) and DELETE handler (line 177) both wrap `transport.handleRequest()` in try/catch, log errors with `console.error`, and send JSON-RPC formatted error responses with the `headersSent` guard. The GET handler for SSE streams had no error handling at all. If `handleRequest` throws (e.g. transport internal error during SSE streaming), Express 5's default error handler returns a generic response without session context logging. For SSE where headers are already sent, the connection breaks silently with no diagnostic trail.

**Fix:** Added try/catch around the GET handler's `handleRequest()` call with `console.error` logging and the same `headersSent` guard pattern used by POST and DELETE.

**Files changed:** `src/index.ts`

---

## Issue 15: TOCTOU race in MAX_SESSIONS allows exceeding session limit [SCALE / PERFORMANCE]

**Category:** Scale/Performance

The `Object.keys(transports).length >= MAX_SESSIONS` check runs synchronously, but the transport is only added to `transports` inside the `onsessioninitialized` callback, which fires during the later `await transport.handleRequest()` call. Between the check and the callback, `await server.connect(transport)` yields to the event loop. Two concurrent initialize requests can both pass the check (both see 99/100) before either registers, exceeding the MAX_SESSIONS limit. Under load with dozens of users connecting simultaneously, the resource exhaustion protection from Issue 11 is bypassed.

**Fix:** Added a `pendingSessionCount` counter that is incremented synchronously right after the MAX_SESSIONS check passes (before any `await`), decremented in `onsessioninitialized` when the transport registers, and decremented in the catch block if initialization fails. The check now uses `Object.keys(transports).length + pendingSessionCount`.

**Files changed:** `src/index.ts`

---

## Issue 16: No file size limit on attachment upload, OOM risk [SCALE / PERFORMANCE]

**Category:** Scale/Performance

The `add_case_attachment` tool accepted `fileContent` as `z.string()` with no maximum length. `Buffer.from(args.fileContent, 'base64')` allocated an unbounded buffer, then `new Blob([fileBuffer])` created another copy. A single 100MB file produces ~130MB base64 + 100MB buffer + 100MB blob = ~330MB of memory. With multiple concurrent uploads across sessions, this can exhaust server memory and crash the process for all users. The MAX_SESSIONS limit (Issue 11) doesn't help because each session can trigger the OOM independently.

**Fix:** Added `MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024` (25MB) constant. The attachment handler checks `fileBuffer.length` after base64 decode and returns an `isError` result if exceeded, before creating the Blob or FormData.

**Files changed:** `src/tools/cases.ts`, `src/constants.ts`

---

## Issue 17: Bearer auto-auth stores unvalidated token, creating zombie session [SECURITY / SCALE]

**Category:** User Security and Privacy, Scale/Performance

The bearer auto-auth path called `tokenManager.storeOfflineToken(newSessionId, bearerToken)`, which created a session entry with `accessToken: ''` and `expiresAt: 0` without ever contacting SSO. `hasSession()` returned `true` immediately, so `requireAuth` passed. On every subsequent tool call, `getAccessToken()` found the expired entry, called `fetchAccessToken()` to SSO, and if the bearer token was invalid (not a real offline token), SSO rejected it. But the session entry persisted -- every tool call re-triggered the same failing SSO exchange indefinitely until the session reaper ran 30 minutes later. The log also falsely reported "auto-authenticated via bearer token" before any validation occurred.

**Fix:** Replaced `storeOfflineToken` with `tokenManager.authenticate()` (which actually contacts SSO). The call is fire-and-forget with `.then()/.catch()` since it runs inside the synchronous `onsessioninitialized` callback. The log now says "auto-authenticated" only on SSO success, and warns on failure. Removed the unused `storeOfflineToken` method from `TokenManager`.

**Files changed:** `src/index.ts`, `src/auth.ts`

---

## Issue 18: `search_cases` default rows is 50 but schema describes "default 10" [TOKEN EFFICIENCY]

**Category:** Token Efficiency

`SearchCasesInput.rows` describes itself as `'Number of results to return (default 10, max 100)'`, but the tool handler falls back to `DEFAULT_PAGE_SIZE` (50) via `args.rows ?? DEFAULT_PAGE_SIZE`. The LLM reads the schema description, omits the `rows` parameter expecting 10 results, and receives 50 instead -- 5x more JSON data per search call, directly inflating context token usage.

**Fix:** Added `DEFAULT_SEARCH_ROWS = 10` constant (matching the schema description and knowledge tools' default). The `search_cases` handler now uses `args.rows ?? DEFAULT_SEARCH_ROWS` instead of `DEFAULT_PAGE_SIZE`.

**Files changed:** `src/tools/cases.ts`, `src/constants.ts`

---

## Issue 19: Unbounded base64 decoded into memory before size check (builds on Issue 16) [SCALE / PERFORMANCE]

**Category:** Scale/Performance

Issue 16 added a post-decode size check (`fileBuffer.length > MAX_ATTACHMENT_SIZE_BYTES`), but the check only runs after `Buffer.from(args.fileContent, 'base64')` fully allocates the decoded buffer. The Zod schema for `fileContent` was `z.string()` with no `maxLength`. A 500MB base64 string (~375MB decoded) is fully allocated into a Buffer before the size check rejects it. With dozens of concurrent users, a few oversized upload attempts cause multi-hundred-MB memory spikes before any rejection occurs, risking OOM.

**Fix:** Added `MAX_ATTACHMENT_BASE64_LENGTH` constant (base64 length corresponding to 25MB decoded). Applied `.max(MAX_ATTACHMENT_BASE64_LENGTH)` to the Zod schema so oversized input is rejected at validation time before the handler runs. Also added a pre-decode string length check in the handler as defense-in-depth.

**Files changed:** `src/types/cases.ts`, `src/tools/cases.ts`, `src/constants.ts`

---

## Issue 20: `transports` and `sessionCreatedAt` plain objects susceptible to prototype confusion [SECURITY]

**Category:** User Security and Privacy

`transports` and `sessionCreatedAt` were declared as `Record<string, ...>` (plain objects `{}`). The `mcp-session-id` header is client-controlled. A client sending `__proto__` as the session ID causes `transports['__proto__']` to return `Object.prototype` (truthy), so the "existing session" branch executes with a non-transport object. This leads to a TypeError on `handleRequest()`. Similarly, `constructor` and `toString` hit inherited properties. While the outer catch prevents a crash, this enables wrong code path routing, noisy error logs, and a minor DoS vector via crafted session IDs.

**Fix:** Replaced both plain objects with `Map<string, ...>`. `Map` lookups only match explicitly `.set()` entries, immune to prototype chain traversal. Updated all access patterns (`get`/`set`/`has`/`delete`/`size`/`for...of`) across all handlers, reapers, and shutdown hooks.

**Files changed:** `src/index.ts`
