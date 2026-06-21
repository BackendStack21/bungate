# AGENTS.md — Bungate

## Overview

Bungate is a production-grade HTTP gateway and load balancer built on **Bun** runtime
with **0http-bun** router and **fetch-gate** proxy. It provides TLS 1.3, JWT auth,
8+ load balancing strategies, circuit breakers, clustering, and OWASP Top 10 security.

- **Runtime:** Bun (NOT Node.js)
- **Language:** TypeScript (strict mode, `bundler` module resolution)
- **Package manager:** `bun`
- **Test framework:** `bun:test` (`bun test`)
- **Proxy engine:** `fetch-gate`
- **Router:** `0http-bun`

## Development Environment

```bash
# Run inside Docker — Dev
docker exec -i projects-dev bash
export PATH=$HOME/.bun/bin:$PATH
cd /workspace/bungate
```

## Build & Test Commands

```bash
# TypeScript type-check (no emit)
bun run build          # tsc --project tsconfig.build.json

# Full test suite
bun test               # All 803 tests across 44 files

# Specific test files
bun test test/security/utils.test.ts
bun test test/gateway/
bun test test/load-balancer/

# Coverage
bun test --coverage    # Currently 98.97% lines / 94.55% funcs

# Format
bun run format         # Prettier
bun run format:check   # Prettier check-only
```

## Project Structure

```
src/
├── gateway/gateway.ts          # Main BunGateway class (746 lines)
├── proxy/gateway-proxy.ts      # fetch-gate wrapper
├── load-balancer/http-load-balancer.ts  # 8+ strategies, health checks, sticky sessions
├── cluster/cluster-manager.ts  # Multi-process clustering
├── logger/pino-logger.ts       # Pino-based structured logging
├── interfaces/                 # TypeScript interfaces (no runtime code)
│   ├── gateway.ts, middleware.ts, proxy.ts, route.ts, load-balancer.ts
│   └── index.ts
├── security/
│   ├── config.ts               # Security config schema + validation + defaults
│   ├── types.ts                # ValidationResult, ValidationRules, SecurityContext
│   ├── utils.ts                # sanitizePath, recursiveDecodeURIComponent, entropy, etc.
│   ├── input-validator.ts      # Path/header/query validation against blocked patterns
│   ├── validation-middleware.ts # Middleware wrapping InputValidator
│   ├── error-handler.ts        # SecureErrorHandler (production/development modes)
│   ├── error-handler-middleware.ts # Middleware with circuit breaker detection
│   ├── jwt-key-rotation.ts     # JWKS refresh, multi-secret key rotation
│   ├── jwt-key-rotation-middleware.ts
│   ├── security-headers.ts     # HSTS, CSP, X-Frame-Options, etc.
│   ├── session-manager.ts      # 128-bit entropy session management
│   ├── size-limiter.ts         # Request size validation
│   ├── size-limiter-middleware.ts
│   ├── tls-manager.ts          # TLS certificate loading + validation
│   ├── trusted-proxy.ts        # Secure client IP extraction
│   └── http-redirect.ts        # HTTP→HTTPS redirect server
└── index.ts                    # Public API exports
```

## Security Design Principles

### Path Validation (input-validator.ts + utils.ts)

**Two-pass validation** against double-encoding attacks:

1. **First pass:** Check raw path against `blockedPatterns` (catches null bytes, `../`)
2. **Recursive decode:** `recursiveDecodeURIComponent()` decodes up to 5 layers until stable
3. **Second pass:** Check fully-decoded path (catches `%252f` → `%2f` → `/`)

Never validate before decoding — attackers hide behind encoding layers.

### Health Checks (http-load-balancer.ts)

Threshold-based to prevent flapping and cascade failures:

- `failureThreshold` (default 3): consecutive failures before marking unhealthy
- `successThreshold` (default 2): consecutive successes before marking healthy again
- `minHealthyTargets` (default 1): floor check — refuses to mark the last healthy target down

Floor exempts when ALL targets are already unhealthy (genuine outage, not a cascade to prevent).

### Rate Limiting (gateway.ts)

Uses gateway's `getClientIP()` as the rate limit key generator, NOT `X-Forwarded-For`.
`getClientIP()` consults `TrustedProxyValidator` when enabled, otherwise falls back to
secure header priority (`cf-connecting-ip` > `x-real-ip`).

### Error Handling

Global error handler registered on the 0http-bun router. In production:

- Returns sanitized `{"error":"Internal server error"}` with status 500
- Never leaks stack traces or internal file paths
- Logs full error details internally

### Blocked Patterns (config.ts)

```typescript
blockedPatterns: [
  /\.\./,
  /%2e%2e/i,
  /%2f/i,
  /%5c/i,
  /%00/,
  /\0/,
  /%25%32%[fF]/i,
]
```

Covers: raw `..`, encoded `../`, encoded `/`, encoded `\`, null byte, double-encoded `/`.

## Testing Conventions

- Use `bun:test` (`describe`, `test`, `expect`, `beforeAll`, `afterAll`)
- Private method access: `(instance as any).privateMethod()`
- Load balancer tests: use `LoadBalancerConfig` + `createLoadBalancer()`
- Security tests: import from `../../src/security/<module>`
- Session tests: use real TTLs (`await new Promise(r => setTimeout(r, N))`), not fake timers
- Gateway E2E tests: start `Bun.serve()` echo servers, create `BunGateway`, call `listen()` + `close()`

## Common Pitfalls

1. **Don't validate before decoding.** Path validation must decode first, then validate.
   One-pass validation misses `%252f` (double-encoded) and `....//` (quad-dot).

2. **JS bit-shift at 32 bits.** `1 << 32` equals `1` in JavaScript (only lower 5 bits used).
   The `isIPInCIDR` function special-cases prefix `0` for this reason.

3. **Truthiness vs. null checks.** `config.sessions.ttl && config.sessions.ttl <= 0` short-circuits
   when `ttl` is `0` (falsy). Use `!= null` for numeric validation.

4. **Always clean up.** Gateway tests must call `await gateway.close()` in `finally` blocks.
   Load balancer tests must call `manager.destroy()` / `loadBalancer.destroy()`.

5. **Port conflicts.** E2E tests use specific ports (8100-8102 for echo servers, 3002+ for gateways).
   If a test hangs, check for stale Bun processes.

6. **Don't modify node_modules.** Rate limiter and CORS live in `node_modules/0http-bun/lib/middleware/`.
   Fixes go in bungate source (e.g., custom `keyGenerator`), not in deps.

7. **TypeScript strict mode.** Properties like `noUncheckedIndexedAccess` are on. Array accesses
   like `targets[0]` need explicit `!` assertions or length checks.

## CI/CD

- Pushes to `main` trigger GitHub Actions (see `.github/workflows/`)
- `act` can run workflows locally: `bun run actions`
- Release tags follow format `vYYYY.M.D` (e.g., `v1.0.1`)
- Releases created via `gh release create`

## Landing Page

- Source: `docs/index.html`
- Deployed to: `bungate.21no.de` (GitHub Pages)
- Design system: `assets.21no.de` (CSS tokens, fonts, nav, hero, cards)
- Colors: `#0a0a0b` background, `#38bdf8` accent
- Fonts: `Outfit` (headings), `JetBrains Mono` (code)
