# Bungate Red-Team Security Findings

**Audit date:** 2026-06-21  
**Scope:** `src/`, `examples/`, `benchmark/`, `docs/`, `package.json`, `tsconfig*.json`, CI configuration  
**Methodology:** Static code review focused on OWASP Top 10, request handling, proxy forwarding, load balancing, authentication/session management, TLS, logging, and operational security.

---

## Executive Summary

Bungate has a solid security baseline for a Bun/TypeScript gateway, but several high-severity issues allow attackers to spoof identity, bypass rate limiting, smuggle requests to upstream targets, and obtain sensitive metadata. The most urgent issues are:

1. **Client IP and forwarded-header spoofing** across the gateway, rate limiter, load balancer, and error handler.
2. **Unsafe proxy forwarding** of hop-by-hop, `Host`, and sensitive authentication headers.
3. **SSRF and DoS via health checks** in the load balancer.
4. **Sticky-session fixation** and weak load-balancer randomness.
5. **Committed hardcoded secrets and private key** in examples.
6. **Prototype pollution** via config merging.
7. **TLS hardening options validated but never applied** to `Bun.serve`.

This document details each finding with severity, evidence, exploit scenario, and recommended remediation. A linked remediation PR should address every item before the next release.

---

## Critical

### CRIT-1 — Hardcoded TLS private key committed to repository

- **Files:** `examples/key.pem` (entire file), `examples/cert.pem`
- **Severity:** Critical
- **Evidence:** A complete RSA private key is committed alongside its certificate in the examples directory.
- **Exploit scenario:** Anyone with repository or npm package access can impersonate the TLS endpoint, perform MITM, or decrypt traffic if the certificate is trusted. The key is in git history and may be distributed.
- **Remediation:**
  - Remove the private key from git history (`git filter-repo` / BFG).
  - Add `*.pem`, `*.key`, `*.crt`, `examples/cert.*` to `.gitignore`.
  - Provide a script that generates self-signed certificates locally; never commit private keys.
  - Rotate any infrastructure that reused this key.

---

## High

### HIGH-1 — Client IP extraction trusts attacker-controlled headers

- **Files:** `src/gateway/gateway.ts` (lines ~566–612), `src/security/trusted-proxy.ts` (lines ~293–410)
- **Severity:** High
- **Evidence:** `BunGateway.getClientIP()` never uses the underlying TCP/socket remote address (`server.requestIP(req)`). In the fallback path it returns the first value of `X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`, or `X-Client-IP`. When `trustedProxies` is enabled, the validator is still given a `directIP` derived from those same headers, not the real peer address.
- **Exploit scenario:** An attacker rotates `X-Forwarded-For` to obtain fresh rate-limit buckets, evades IP-based logging/allowlists, frames arbitrary IPs in logs, and can spoof a trusted proxy IP to have attacker-controlled forwarded chains accepted.
- **Remediation:**
  - Use `this.server?.requestIP(req)` as the only trusted direct peer address.
  - Pass that socket IP to `TrustedProxyValidator`.
  - Walk `X-Forwarded-For` from right to left, trusting only consecutive trusted-proxy hops, and return the first untrusted entry.
  - Reject private/loopback extracted IPs unless explicitly allowed.

### HIGH-2 — Hop-by-hop / `Connection` headers forwarded verbatim to upstream

- **Files:** `src/gateway/gateway.ts` (proxy invocation), `src/proxy/gateway-proxy.ts`, `node_modules/fetch-gate/lib/proxy.js` (`prepareHeaders`)
- **Severity:** High
- **Evidence:** The original `Request` object is passed to `proxy.proxy()` without stripping `Transfer-Encoding`, `Connection`, `Keep-Alive`, `TE`, `Trailer`, `Upgrade`, `Proxy-Authorization`, or any header listed in `Connection`. Client-supplied `X-Forwarded-For`, `X-Real-IP`, etc. are also forwarded.
- **Exploit scenario:** Request smuggling / HTTP desync when Bun and the upstream parse chunked vs. `Content-Length` differently; backend IP spoofing / cache poisoning via unchecked `X-Forwarded-*` headers.
- **Remediation:**
  - Sanitize headers before forwarding: drop hop-by-hop headers and any header named in `Connection`.
  - Re-derive and set `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Port`, and `X-Forwarded-Host` from trusted proxy state.
  - Strip or rewrite the client `Host` header to the upstream hostname.

### HIGH-3 — Sensitive authentication headers leaked upstream

- **Files:** `src/proxy/gateway-proxy.ts`, `node_modules/fetch-gate/lib/proxy.js`, `src/gateway/gateway.ts`
- **Severity:** High
- **Evidence:** All request headers are mirrored to backends, including `Cookie`, `Authorization`, and `Proxy-Authorization`.
- **Exploit scenario:** A session cookie or bearer token valid for the gateway is forwarded to any route’s upstream. If one route proxies to an external or compromised service, credentials leak. `Proxy-Authorization`, intended for the gateway itself, is also forwarded.
- **Remediation:**
  - Implement a configurable header allowlist/denylist. By default strip `Cookie`, `Authorization`, and `Proxy-Authorization` unless the route explicitly maps/rewrites them.
  - Support per-route `forwardHeaders` / `stripHeaders` configuration.

### HIGH-4 — Redirect following enabled by default without validation

- **Files:** `src/gateway/gateway.ts` (~419), `src/proxy/gateway-proxy.ts`, `node_modules/fetch-gate/lib/proxy.js`
- **Severity:** High
- **Evidence:** `followRedirects` defaults to `true`. `fetch-gate` relies on Bun’s default redirect behavior and does not validate `Location` headers.
- **Exploit scenario:** A malicious upstream returns `302 Location: https://attacker.tld`; the gateway follows the redirect and returns attacker content under the gateway domain, enabling phishing, open redirect, or SSRF to internal/metadata endpoints.
- **Remediation:**
  - Default `followRedirects` to `false`.
  - When enabled, validate every redirect `Location` against an allowlist and enforce `maxRedirects`.

### HIGH-5 — Health-check SSRF, URL injection, and missing redirect limits

- **Files:** `src/load-balancer/http-load-balancer.ts` (~780–800)
- **Severity:** High
- **Evidence:** `performHealthChecks()` constructs `new URL(target.url)` and appends `healthCheckConfig.path`, then calls `fetch()` without scheme/host validation, no whitelist, and no `redirect` / `maxRedirects` control. The method is taken from config without validation.
- **Exploit scenario:** A malicious or compromised config/admin sets a target URL such as `http://169.254.169.254/`. The balancer periodically fetches cloud metadata or internal APIs. Unrestricted redirects allow an external endpoint to redirect into internal networks.
- **Remediation:**
  - Validate target URLs against an allowlist of schemes (`http`/`https`) and hosts/networks.
  - Set `redirect: 'manual'` or cap redirects.
  - Optionally restrict health-check hosts to a configured backend network.
  - Validate the HTTP method against an allowlist (`GET`, `HEAD`).

### HIGH-6 — Health-check response body exhaustion (memory DoS)

- **Files:** `src/load-balancer/http-load-balancer.ts` (~805–807)
- **Severity:** High
- **Evidence:** When `expectedBody` is configured, the code calls `await response.text()` with no size limit.
- **Exploit scenario:** A malicious backend streams an enormous response, causing the gateway process to OOM.
- **Remediation:**
  - Limit health-check response reads (e.g., 4 KB) using `response.body.getReader()` or a bounded consumer.
  - Cancel the response body once the match is determined.

### HIGH-7 — Sticky-session fixation and predictable routing

- **Files:** `src/load-balancer/http-load-balancer.ts` (~612–668, ~631–649)
- **Severity:** High
- **Evidence:** Sticky sessions rely on a session ID supplied by the client via cookie. The balancer never emits its own `Set-Cookie`. The cookie value is parsed with naive `split('=')` and never validated for format/entropy before becoming a session key.
- **Exploit scenario:** An attacker forges or reuses a known session ID cookie (e.g., `lb-session=<fixed-value>`) and forces repeated routing to a specific backend, enabling session fixation, targeted cache poisoning, or load-distribution bypass.
- **Remediation:**
  - Generate and emit a secure `Set-Cookie` header after the first target selection.
  - Validate incoming session IDs against the stored session map; reject unknown/invalid values.
  - Add `HttpOnly`, `Secure`, and `SameSite=Strict` attributes.
  - Rotate session IDs periodically.

### HIGH-8 — Client IP spoofing in `ip-hash` strategy

- **Files:** `src/load-balancer/http-load-balancer.ts` (~526–538, ~690–744)
- **Severity:** High
- **Evidence:** `getClientId()` reads `X-Forwarded-For` and takes the first IP without trust validation when no `TrustedProxyValidator` is configured. Even with the validator enabled, the `directIP` is derived from headers, not the socket address.
- **Exploit scenario:** An attacker sends `X-Forwarded-For: <victim-ip>` to deterministically route arbitrary clients to the same backend target as the victim (hash collision / routing manipulation).
- **Remediation:**
  - Obtain the client IP from the underlying Bun connection/socket, then optionally validate forwarded headers only from trusted proxies.
  - Do not use user-controlled headers as the primary IP source.

### HIGH-9 — Request body size limit bypass for chunked / mismatched bodies

- **Files:** `src/security/size-limiter.ts` (~36–59, ~141–175)
- **Severity:** High
- **Evidence:** `validateBodySize()` only parses `Content-Length`. If the header is absent (chunked transfer) or set to a value smaller than the actual streamed body, the limiter returns `valid: true` and never counts bytes.
- **Exploit scenario:** An attacker streams a multi-gigabyte chunked request (or sends `Content-Length: 1` while streaming a huge body) to exhaust memory / CPU / upstream bandwidth, bypassing the configured limit.
- **Remediation:**
  - Tee or consume `req.body` up to `maxBodySize`, abort with 413 when exceeded.
  - Reject requests where counted bytes do not match `Content-Length`.
  - Consider enforcing `maxRequestBodySize` at the `Bun.serve` layer as a defense-in-depth default.

### HIGH-10 — TLS hardening options validated but never passed to `Bun.serve`

- **Files:** `src/security/tls-manager.ts` (~15–21, ~173–179), `src/gateway/gateway.ts` (~661–665)
- **Severity:** High
- **Evidence:** `BunTLSOptions` only exposes `cert`, `key`, `ca`, `passphrase`, `dhParamsFile`. `minVersion`, `cipherSuites`, `requestCert`, and `rejectUnauthorized` are validated but never included in the options given to `Bun.serve`.
- **Exploit scenario:** An operator sets `minVersion: 'TLSv1.3'` or `requestCert: true` for mTLS, but Bun falls back to defaults, allowing TLS 1.2, default ciphers, and no client certificate requirement.
- **Remediation:**
  - Extend `BunTLSOptions` and `getTLSOptions()` to forward `minVersion`, `cipherSuites`, `requestCert`, and `rejectUnauthorized` to `Bun.serve`.
  - Default `minVersion` to `TLSv1.2` or higher and `rejectUnauthorized: true`.

### HIGH-11 — Default hardcoded secrets in the “security-hardened” example

- **File:** `examples/security-hardened.ts` (~113–121)
- **Severity:** High
- **Evidence:** Fallback literals are provided for `jwtPrimary`, `jwtOld`, `publicApiKeys`, and `metricsApiKey`.
- **Exploit scenario:** Because this file is branded as the production-ready hardening example, users copy-paste it verbatim. Fallback literals become live secrets, allowing JWT forgery, API-key bypass, and unauthorized metrics access.
- **Remediation:**
  - Remove all fallback secret literals.
  - Throw at startup if required environment variables are missing.
  - Document that the example will not start without env vars.

---

## Medium

### MED-1 — Global `rateLimit` config is silently ignored

- **File:** `src/gateway/gateway.ts` (~189–213, ~375–388)
- **Severity:** Medium
- **Evidence:** `GatewayConfig` exposes a top-level `rateLimit` option, but the constructor only registers rate limiting when `route.rateLimit` is set.
- **Exploit scenario:** A deployment relying on global rate limiting is unprotected against brute-force / DoS traffic.
- **Remediation:** Register a global `createRateLimit()` middleware using the secure `getClientIP()` key generator.

### MED-2 — `config.server.hostname` is ignored

- **File:** `src/gateway/gateway.ts` (~653–669)
- **Severity:** Medium
- **Evidence:** `serverOptions` only sets `port`, `fetch`, `reusePort`, and optional `tls`. The user-supplied `config.server.hostname` is never forwarded to `Bun.serve`.
- **Exploit scenario:** An admin sets `server: { hostname: '127.0.0.1' }` to keep the gateway local, but it still binds to `0.0.0.0` and is reachable from the network.
- **Remediation:** Pass `hostname: config.server?.hostname` into `Bun.serve()`.

### MED-3 — No default request size / timeout limits

- **File:** `src/gateway/gateway.ts` (~200–209, ~653–669)
- **Severity:** Medium
- **Evidence:** `Bun.serve()` is invoked without `maxRequestBodySize`, idle/connection timeouts, or header-size limits. The size-limiter middleware is only added if `config.security?.sizeLimits` is truthy.
- **Exploit scenario:** Slowloris-style connections, huge bodies, or oversized headers can exhaust memory/CPU and crash workers.
- **Remediation:** Always set conservative `Bun.serve` limits and install the size-limiter with secure defaults.

### MED-4 — `security.corsValidation` is never enforced

- **File:** `src/gateway/gateway.ts` (~336–346)
- **Severity:** Medium
- **Evidence:** The gateway passes `config.cors` directly into `createCORS()`. `SecurityConfig` includes `corsValidation` (e.g., `allowWildcardWithCredentials`, `requireHttps`), but it is never read or applied.
- **Exploit scenario:** A configuration such as `cors: { origin: '*', credentials: true }` is accepted, leading to credential leakage.
- **Remediation:** Validate the merged CORS config against `security.corsValidation` before registering the CORS middleware; reject dangerous combos.

### MED-5 — HTTP redirect server vulnerable to Host-header injection / open redirect

- **File:** `src/security/http-redirect.ts` (~42–76)
- **Severity:** Medium
- **Evidence:** `redirectHost = hostname || url.hostname`, where `url.hostname` comes from the request `Host` header when no explicit `hostname` is configured.
- **Exploit scenario:** A victim is sent to the HTTP redirect port with `Host: evil.com`; the server replies `Location: https://evil.com/...`, enabling phishing or cache poisoning.
- **Remediation:**
  - Always validate the incoming `Host` header against an allowlist.
  - Default to the configured TLS hostname/SNI and never use the raw request host.

### MED-6 — JWT tokens can be issued and accepted without expiration

- **File:** `src/security/jwt-key-rotation.ts` (~192–221, ~227–291)
- **Severity:** Medium
- **Evidence:** `signToken()` only sets expiration when `options?.expiresIn` is provided. `verifyToken()` accepts tokens without an `exp` claim.
- **Exploit scenario:** A leaked token remains valid forever; there is no forced re-authentication or revocation other than deleting the secret.
- **Remediation:**
  - Reject tokens missing `exp` in `verifyToken()`.
  - Default `signToken()` to a sensible expiry (e.g., 1 hour) when none is provided.

### MED-7 — Session fixation via reused session ID after authentication

- **File:** `src/security/session-manager.ts` (~269–286)
- **Severity:** Medium
- **Evidence:** `getOrCreateSession()` returns the existing session and refreshes its TTL without rotating the session ID.
- **Exploit scenario:** An attacker plants a known session cookie; after the victim authenticates, the same session ID is reused, allowing session fixation/hijacking.
- **Remediation:**
  - Regenerate the session ID after login or any privilege change.
  - Invalidate the old session and re-issue the cookie.

### MED-8 — `minHealthyTargets` floor bypass and logic errors

- **File:** `src/load-balancer/http-load-balancer.ts` (~330–336, ~876–905)
- **Severity:** Medium
- **Evidence:** `updateTargetHealthWithFloor()` is only invoked from `performHealthChecks()`. The public `updateTargetHealth(url, false)` calls `updateTargetHealth()` directly, bypassing the floor. If `minHealthyTargets` exceeds total targets, `healthyCount` can never reach the floor, so no target can be marked unhealthy unless all others are already down.
- **Exploit scenario:** An external monitor or admin call can mark the last healthy target unhealthy despite `minHealthyTargets: 1`. Conversely, a too-high value silently disables health-based removal.
- **Remediation:**
  - Centralize all health transitions through `updateTargetHealthWithFloor()`.
  - Clamp `minHealthyTargets` to `Math.min(configured, totalTargets)` and validate at construction.

### MED-9 — Race conditions / non-atomic target state mutations

- **File:** `src/load-balancer/http-load-balancer.ts` (~166–260, ~330–336, ~426–450, ~603–610, ~761–870)
- **Severity:** Medium
- **Evidence:** `selectTarget()`, `recordRequest()`, `recordResponse()`, `updateConnections()`, `updateTargetHealth()`, and async `performHealthChecks()` mutate shared `InternalTarget` object references. No locks, version stamps, or atomic operations exist. `getHealthyTargets()` returns live references that can become stale immediately.
- **Exploit scenario:** A target can be selected as healthy, then marked unhealthy before `recordRequest()` runs, causing accounting on an unhealthy target. Concurrent metric updates can lose increments under load.
- **Remediation:**
  - Use immutable target snapshots for selection decisions.
  - Apply health-state changes atomically (single state field with versioning).
  - Coordinate metric updates through a central synchronized path or per-target queues.

### MED-10 — Weighted strategy manipulation via zero/negative weights

- **File:** `src/load-balancer/http-load-balancer.ts` (~497–516)
- **Severity:** Medium
- **Evidence:** `selectWeighted()` does not clamp negative weights. If all weights are zero, the loop never reaches `random <= 0` and falls back to `targets[0]`. Negative weights distort selection probabilities.
- **Exploit scenario:** An attacker who can influence target configuration can drain traffic from a target or distort selection.
- **Remediation:**
  - Validate and normalize weights at construction and in `addTarget()`: reject negative weights; treat zero as 1.
  - Use the same clamping logic across all weighted strategies.

### MED-11 — Information leakage through target state

- **File:** `src/load-balancer/http-load-balancer.ts` (~346–348, ~377–397)
- **Severity:** Medium
- **Evidence:** `getTargets()` returns live internal target objects including backend URLs, health state, connections, response times, and metadata. `getStats()` returns per-target counts, error rates, and timestamps.
- **Exploit scenario:** If exposed through any monitoring endpoint, attackers can enumerate backends, identify weak targets, and infer traffic patterns.
- **Remediation:**
  - Return sanitized copies/aggregates, not live references.
  - Strip sensitive `metadata` and backend URLs unless explicitly configured for export.

### MED-12 — Health-check flood DoS / unsafe intervals

- **File:** `src/load-balancer/http-load-balancer.ts` (~402–411, ~767–769)
- **Severity:** Medium
- **Evidence:** `setInterval(performHealthChecks, interval)` has no lower bound, jitter, or validation that `timeout < interval`.
- **Exploit scenario:** A config with `interval: 1` and many targets causes a tight loop of outbound health probes, DoS-ing backends and consuming gateway resources. Overlapping waves occur when `timeout > interval`.
- **Remediation:**
  - Enforce minimum interval (e.g., ≥ 1000 ms), ensure `timeout < interval`.
  - Cap `failureThreshold`/`successThreshold` to reasonable ranges.
  - Add randomized jitter to intervals.

### MED-13 — Log injection / log forgery via unsanitized user input

- **Files:** `src/security/trusted-proxy.ts` (~256–260, ~316–330, ~390–394), `src/gateway/gateway.ts` (~156–176)
- **Severity:** Medium
- **Evidence:** `remoteIP` and `chain` values from HTTP headers are embedded in structured logs. `gateway.ts` global error handler logs raw `err.message`, `err.stack`, `req?.url`, and `req?.method`.
- **Exploit scenario:** Newline/control characters or forged JSON fields can corrupt SIEM parsing, hide attacks, or forge audit events. Stack traces leak internal file paths.
- **Remediation:**
  - Pass user-controlled values only as structured Pino properties (never concatenate into message strings).
  - Validate/sanitize IP/header values before logging.
  - Redact or hash `err.stack` in production logs; include it only under `development` or an explicit debug flag.

### MED-14 — Prototype pollution via unguarded config spreading

- **Files:** `src/security/config.ts` (~339–381), `src/cluster/cluster-manager.ts` (~91–100), `src/logger/pino-logger.ts` (~52–57), `src/load-balancer/http-load-balancer.ts` (~114), `src/security/size-limiter.ts` (~28–29)
- **Severity:** Medium
- **Evidence:** Config merging repeatedly spreads user input into shallow-cloned objects without filtering `__proto__`, `constructor`, or `prototype`.
- **Exploit scenario:** A malicious or compromised configuration source can pollute `Object.prototype`, altering behavior of every object in the process (e.g., disabling security middleware, changing defaults).
- **Remediation:**
  - Use `Object.create(null)` for merged result objects, or filter prototype keys before spreading.
  - Prefer a `safeMerge` helper or a library with prototype-pollution protection.

### MED-15 — Cluster manager passes full environment and inherits stdio to workers

- **File:** `src/cluster/cluster-manager.ts` (~103, ~151–163)
- **Severity:** Medium
- **Evidence:** Workers are spawned with `env: { ...process.env, ... }` and `stdio: ['inherit', 'inherit', 'inherit']`. The fallback `workerScript` can come from `process.argv[1]`.
- **Exploit scenario:** All environment variables (secrets) are cloned into every worker. If a worker is compromised or logs its env on crash, secrets leak. `stdio: 'inherit'` mixes worker logs/errors with the master. The fallback worker script could execute an unexpected file.
- **Remediation:**
  - Explicitly enumerate env vars needed by workers (allow-list).
  - Use separate stdio pipes and route worker logs through the master logger with sanitization.
  - Validate `workerScript` against an allow-list of known entry points.

### MED-16 — Supply-chain / dependency integrity weaknesses

- **Files:** `package.json` (~30), `.github/workflows/tests.yaml` (~15)
- **Severity:** Medium
- **Evidence:** `@types/bun` is pinned to `latest`. CI runs `bun install` without `--frozen-lockfile`.
- **Exploit scenario:** A compromised `@types/bun` release (or transitive dependency) can be pulled automatically into CI and developer machines. CI may silently upgrade transitive versions or ignore lockfile drift.
- **Remediation:**
  - Pin `@types/bun` to an exact version or reviewed range.
  - Add `--frozen-lockfile` to CI install steps.
  - Configure `bunfig.toml` with `[install.security] scanner = …` and enable `bun pm scan`.

### MED-17 — Upstream response headers not sanitized

- **Files:** `src/proxy/gateway-proxy.ts`, `node_modules/fetch-gate/lib/proxy.js` (~56–84, ~167–194), `src/gateway/gateway.ts` (~544–549)
- **Severity:** Medium
- **Evidence:** The upstream `Response` is returned directly. Hop-by-hop headers (`Connection`, `Keep-Alive`, `Transfer-Encoding`) and backend-identifying headers (`Server`, `X-Powered-By`, `Set-Cookie`) reach the client.
- **Exploit scenario:** A backend can set `Set-Cookie` scoped to the gateway domain, set cache-poisoning headers, or leak internal server versions.
- **Remediation:**
  - Filter hop-by-hop response headers.
  - Optionally strip `Server`, `X-Powered-By`, and other identifying headers.
  - Validate `Set-Cookie` domains/paths.

### MED-18 — Missing upstream TLS verification controls

- **Files:** `src/proxy/gateway-proxy.ts` (~60–62), `node_modules/fetch-gate/lib/types.d.ts` (~5–22), `node_modules/fetch-gate/lib/proxy.js` (~10–31)
- **Severity:** Medium
- **Evidence:** `ProxyOptions` exposes no TLS settings (`ca`, `cert`, `key`, `rejectUnauthorized`, `minVersion`). Bungate’s `TLSConfig.rejectUnauthorized` is only for the inbound server.
- **Exploit scenario:** Operators cannot enforce certificate pinning or mutual TLS for upstream connections. No minimum TLS version can be enforced for backend calls.
- **Remediation:** Extend `ProxyOptions` with upstream TLS options and forward them to the underlying fetch/TLS layer. Default to strict verification.

### MED-19 — Weak JWT secrets and algorithm/key mismatch allowed

- **Files:** `src/security/jwt-key-rotation.ts` (~89–105), `src/security/jwt-key-rotation-middleware.ts` (~86–100)
- **Severity:** Medium (configuration-dependent)
- **Evidence:** `validateConfig()` checks algorithm names against a fixed list but does not enforce minimum key length/entropy or validate key type vs. algorithm.
- **Exploit scenario:** Operators can configure a short HS256 secret, or accidentally configure an RSA public key as the HMAC key. An attacker can sign a token with `alg: HS256` using the public key and have it accepted.
- **Remediation:**
  - Enforce minimum entropy per algorithm (e.g., 256 bits for HS256).
  - Validate key type vs. algorithm and reject `none`.
  - Provide warnings for deprecated/plaintext string secrets.

### MED-20 — `sanitizeHeader` permits high bytes and strips tab

- **File:** `src/security/utils.ts` (~115–122)
- **Severity:** Medium
- **Evidence:** The regex `/[\x00-\x1F\x7F]/` removes C0/DEL but leaves `\x80-\xFF` and removes HTAB.
- **Exploit scenario:** High bytes could be interpreted as header continuations or line separators by downstream parsers, enabling response splitting.
- **Remediation:** Restrict values to RFC 7230 `field-vchar` (printable ASCII / obs-text) and HTAB, or rely on the `Headers` API’s built-in validation.

### MED-21 — Custom security headers are not validated for injection

- **File:** `src/security/security-headers.ts` (~91–96)
- **Severity:** Medium
- **Evidence:** `customHeaders` names and values are passed directly to `Headers.set()`.
- **Exploit scenario:** A malicious or misconfigured custom header can override security headers or inject control characters.
- **Remediation:** Validate that header names are RFC 7230 tokens and values contain only allowed vchars; reject control characters and newlines.

---

## Low

### LOW-1 — Default error handler logs full stack traces

- **File:** `src/gateway/gateway.ts` (~161–176)
- **Severity:** Low
- **Evidence:** The built-in error handler logs `err.stack` to the configured logger. While the HTTP response is sanitized, logs can be forwarded to external systems.
- **Remediation:** Respect `security.errorHandling.includeStackTrace`; omit `stack` in production by default.

### LOW-2 — `removeRoute()` leaks framework information

- **File:** `src/gateway/gateway.ts` (~617)
- **Severity:** Low
- **Evidence:** `throw new Error('removeRoute is not implemented in 0http-bun')` exposes the underlying router library.
- **Remediation:** Return a generic `501 Not Implemented` / `405 Method Not Allowed` response without naming dependencies.

### LOW-3 — No secure default 404 handler

- **File:** `src/gateway/gateway.ts` (~180–182)
- **Severity:** Low
- **Evidence:** If `config.defaultRoute` is not supplied, the gateway relies on 0http-bun’s default unmatched-route behavior.
- **Remediation:** Install a minimal default handler that returns `404 Not Found` with no server/framework identifying body.

### LOW-4 — `timingSafeEqual` is not constant-time and leaks secret length

- **File:** `src/security/utils.ts` (~297–307)
- **Severity:** Low–Medium
- **Evidence:** Returns early when lengths differ; manual XOR loop over `charCodeAt()` is not guaranteed constant-time.
- **Exploit scenario:** A timing side-channel reduces brute-force search space.
- **Remediation:** Use `crypto.timingSafeEqual()` on equal-length `Buffer`/`Uint8Array` values. Hash inputs first if lengths may differ.

### LOW-5 — Overlong / invalid UTF-8 percent encodings not rejected

- **File:** `src/security/utils.ts` (~62–101)
- **Severity:** Low
- **Evidence:** `recursiveDecodeURIComponent()` catches `URIError` but does not reject non-canonical sequences such as overlong UTF-8 (`%C0%AF`).
- **Exploit scenario:** If a downstream component decodes the raw request differently, an overlong encoded slash/backslash could be interpreted as `/` or `\`.
- **Remediation:** Validate the decoded path against canonical UTF-8 and reject overlong or invalid sequences.

### LOW-6 — IPv6 proxies and CIDR ranges are not supported

- **File:** `src/security/utils.ts` (~169–275)
- **Severity:** Low / Info
- **Evidence:** `isValidIP()` uses a simplified IPv6 pattern that does not support `::`, and `isIPInCIDR()` returns `false` when the network string lacks a dot.
- **Exploit scenario:** Valid IPv6 reverse proxies are rejected or treated as untrusted; IPv6 CIDR allowlists silently fail.
- **Remediation:** Use a robust IP library (e.g., `ipaddr.js`) for IPv4/IPv6 parsing and CIDR matching.

### LOW-7 — Numeric security configuration validation uses truthy checks

- **File:** `src/security/config.ts` (~293–313)
- **Severity:** Low
- **Evidence:** Checks such as `config.sessions.entropyBits && config.sessions.entropyBits < 128` short-circuit when the value is `0`, so `0` is never rejected.
- **Exploit scenario:** A value of `0` for TTL or size limits is accepted, causing logic errors or unexpected DoS behavior.
- **Remediation:** Use `!= null` for numeric validation.

### LOW-8 — TLS certificate load errors can leak internal file paths

- **File:** `src/security/tls-manager.ts` (~64–104)
- **Severity:** Low
- **Evidence:** `loadCertificates()` interpolates the configured path and underlying error into thrown messages.
- **Exploit scenario:** Startup errors exposed in logs or a UI leak internal directory layout.
- **Remediation:** Include full paths only in internal logs; redact paths from aggregate/client-facing messages.

### LOW-9 — Malformed double-slash blocked pattern

- **File:** `src/security/config.ts` (~211–219)
- **Severity:** Info
- **Evidence:** `/%25%32%[fF]/i` matches the literal string `%25%32%F`, not a valid double-encoded slash.
- **Remediation:** Remove the dead pattern or replace it with a correct raw check for double-encoded slash (e.g., `/^.*%252[fF].*$/i`).

### LOW-10 — Error middleware uses `console.error` instead of sanitized logger

- **Files:** `src/security/size-limiter-middleware.ts` (~111), `src/security/validation-middleware.ts` (~121)
- **Severity:** Low
- **Evidence:** Unexpected middleware errors are logged directly with `console.error`, bypassing `BunGateLogger` redaction logic.
- **Remediation:** Route these through the gateway logger instance so Pino redaction and sanitization rules apply.

### LOW-11 — Build TypeScript config is less strict than development config

- **Files:** `tsconfig.json`, `tsconfig.build.json`
- **Severity:** Low
- **Evidence:** `tsconfig.build.json` disables `noUncheckedIndexedAccess` and enables `skipLibCheck: true`.
- **Exploit scenario:** Type-level bugs slip through into the published package.
- **Remediation:** Align `tsconfig.build.json` with the stricter dev flags.

### LOW-12 — Missing SubResource Integrity (SRI) on external assets

- **File:** `docs/index.html` (~44–51)
- **Severity:** Low
- **Evidence:** Stylesheets are loaded from `https://assets.21no.de/` with no `integrity` attribute.
- **Exploit scenario:** If the asset host is compromised or DNS hijacked, malicious CSS executes in the documentation origin.
- **Remediation:** Generate SRI hashes for external assets and add `integrity` + `crossorigin="anonymous"`. Self-host critical assets or pin content hashes.

### LOW-13 — Inline scripts and `unsafe-inline` CSP on landing page

- **File:** `docs/index.html` (~20, ~632–679)
- **Severity:** Low
- **Evidence:** CSP includes `script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://assets.21no.de`.
- **Exploit scenario:** `unsafe-inline` largely neutralizes CSP XSS protection.
- **Remediation:** Move inline script to an external file with SRI, then remove `'unsafe-inline'` from `script-src`. Use nonce/hash CSP for styles.

### LOW-14 — Insecure benchmark / example defaults become production templates

- **Files:** `benchmark/bungate-gateway.ts`, `benchmark/docker-compose.yml`, `benchmark/echo-server-simple.ts`, `docs/EXAMPLES.md`, `docs/API_REFERENCE.md`
- **Severity:** Low
- **Evidence:** Benchmark files lack production warnings, echo server returns all request headers, docs show `./cert.pem`/`./key.pem` and `process.env.JWT_SECRET || ...` fallbacks.
- **Exploit scenario:** Users copy benchmark/example files into production, leaking auth headers or using example certificates.
- **Remediation:** Add prominent `/* FOR BENCHMARKING ONLY — NOT FOR PRODUCTION */` headers, redact sensitive headers in the echo server, and remove secret fallbacks from docs.

### LOW-15 — New targets default to healthy before validation

- **File:** `src/load-balancer/http-load-balancer.ts` (~282)
- **Severity:** Low
- **Evidence:** `addTarget()` sets `healthy: target.healthy ?? true`. If health checks are enabled, they run asynchronously, so traffic can be sent to a newly added target before the first probe completes.
- **Exploit scenario:** A misconfigured or malicious target URL added at runtime immediately receives production traffic.
- **Remediation:** Default new targets to `healthy: false` when health checks are enabled, and promote them only after `successThreshold` successes.

### LOW-16 — Weak randomness in load-balancing strategies

- **File:** `src/load-balancer/http-load-balancer.ts` (~506, ~522, ~544–545)
- **Severity:** Low
- **Evidence:** `selectWeighted()`, `selectRandom()`, and `selectPowerOfTwoChoices()` use `Math.random()`, which is not cryptographically secure.
- **Exploit scenario:** Predictable sequences can aid an attacker in crafting requests that reliably hit a specific target.
- **Remediation:** Use `crypto.getRandomValues()` or `generateSecureRandomWithEntropy()` for selection randomness.

---

## Remediation Priority

### Immediate (block release)

1. CRIT-1 — Remove committed TLS private key from repository.
2. HIGH-1 — Use socket IP (`server.requestIP`) for client IP extraction.
3. HIGH-2 — Strip hop-by-hop headers and sanitize forwarded headers before proxying.
4. HIGH-3 — Denylist sensitive auth headers from upstream forwarding by default.
5. HIGH-4 — Default `followRedirects` to `false` and validate redirects when enabled.
6. HIGH-5 — Restrict health-check URLs to prevent SSRF.
7. HIGH-6 — Bound health-check response body reads.
8. HIGH-7 — Generate secure sticky-session cookies server-side.
9. HIGH-9 — Enforce streamed body size limits.
10. HIGH-10 — Forward TLS hardening options to `Bun.serve`.
11. HIGH-11 — Remove hardcoded secrets from `security-hardened.ts` example.

### This sprint

- MED-1 through MED-4 (gateway defaults: rate limit, hostname, size/timeout, CORS validation).
- MED-5 (HTTP redirect Host validation).
- MED-6, MED-7 (JWT expiry, session rotation).
- MED-8 through MED-12 (load balancer health floor, race conditions, weights, stats leakage, health intervals).
- MED-13 through MED-16 (log sanitization, prototype pollution, cluster env allow-list, dependency pinning).
- MED-17, MED-18 (upstream response header / TLS controls).
- MED-19 through MED-21 (JWT entropy, header sanitization).

### Next sprint

- LOW-1 through LOW-16 (information disclosure, strict TS config, SRI, CSP, benchmark warnings, weak randomness, etc.).

---

## Positive Security Controls Observed

- `alg: none` is explicitly rejected; the allowed JWT algorithm list contains only signed algorithms.
- Production error responses are sanitized and do not include stack traces.
- Session IDs are generated from 128 bits of cryptographic randomness by default.
- HSTS, `X-Frame-Options`, and `X-Content-Type-Options` are enabled by default.
- Path validation uses two-pass raw + decoded checks, catching basic double-encoding traversal attempts.
- Health checks use threshold-based logic with `failureThreshold`, `successThreshold`, and `minHealthyTargets`.

---

_This document is a living artifact. As fixes are merged, update this file to mark items resolved and reference the relevant commits/PRs._
