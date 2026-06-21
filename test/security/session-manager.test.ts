import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  SessionManager,
  createSessionManager,
} from '../../src/security/session-manager'
import { hasMinimumEntropy } from '../../src/security/utils'
import type { SessionConfig } from '../../src/security/config'

describe('SessionManager', () => {
  let sessionManager: SessionManager

  beforeEach(() => {
    sessionManager = new SessionManager()
  })

  afterEach(() => {
    sessionManager.destroy()
  })

  describe('constructor and factory', () => {
    test('should create SessionManager instance', () => {
      expect(sessionManager).toBeDefined()
      expect(sessionManager).toBeInstanceOf(SessionManager)
    })

    test('should create SessionManager via factory function', () => {
      const manager = createSessionManager()
      expect(manager).toBeDefined()
      expect(manager).toBeInstanceOf(SessionManager)
      manager.destroy()
    })

    test('should accept custom configuration', () => {
      const config: Partial<SessionConfig> = {
        entropyBits: 256,
        ttl: 7200000,
        cookieName: 'custom_session',
      }
      const manager = new SessionManager(config)
      expect(manager).toBeDefined()
      const managerConfig = manager.getConfig()
      expect(managerConfig.entropyBits).toBe(256)
      expect(managerConfig.ttl).toBe(7200000)
      expect(managerConfig.cookieName).toBe('custom_session')
      manager.destroy()
    })

    test('should enforce minimum 128-bit entropy requirement', () => {
      expect(() => {
        new SessionManager({ entropyBits: 64 })
      }).toThrow('Session entropy must be at least 128 bits')
    })

    test('should use secure defaults', () => {
      const config = sessionManager.getConfig()
      expect(config.entropyBits).toBeGreaterThanOrEqual(128)
      expect(config.cookieOptions.secure).toBe(true)
      expect(config.cookieOptions.httpOnly).toBe(true)
      expect(config.cookieOptions.sameSite).toBe('strict')
    })
  })

  describe('generateSessionId', () => {
    test('should generate a session ID', () => {
      const sessionId = sessionManager.generateSessionId()
      expect(sessionId).toBeDefined()
      expect(typeof sessionId).toBe('string')
      expect(sessionId.length).toBeGreaterThan(0)
    })

    test('should generate unique session IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(sessionManager.generateSessionId())
      }
      expect(ids.size).toBe(100)
    })

    test('should generate session IDs with minimum 128 bits of cryptographic entropy', () => {
      const sessionId = sessionManager.generateSessionId()
      // 128 bits = 16 bytes = 32 hex characters minimum
      expect(sessionId.length).toBeGreaterThanOrEqual(32)
      // Should be valid hex string from crypto.randomBytes
      expect(/^[0-9a-f]+$/i.test(sessionId)).toBe(true)
      // Should pass validation
      expect(sessionManager.validateSessionId(sessionId)).toBe(true)
    })

    test('should generate session IDs with configured entropy', () => {
      const manager = new SessionManager({ entropyBits: 256 })
      const sessionId = manager.generateSessionId()
      // 256 bits should have at least 128 bits (and likely much more)
      expect(hasMinimumEntropy(sessionId, 128)).toBe(true)
      manager.destroy()
    })

    test('should validate generated session IDs', () => {
      const sessionId = sessionManager.generateSessionId()
      expect(sessionManager.validateSessionId(sessionId)).toBe(true)
    })
  })

  describe('validateSessionId', () => {
    test('should validate a valid session ID', () => {
      const sessionId = sessionManager.generateSessionId()
      expect(sessionManager.validateSessionId(sessionId)).toBe(true)
    })

    test('should reject empty session ID', () => {
      expect(sessionManager.validateSessionId('')).toBe(false)
    })

    test('should reject null session ID', () => {
      expect(sessionManager.validateSessionId(null as any)).toBe(false)
    })

    test('should reject undefined session ID', () => {
      expect(sessionManager.validateSessionId(undefined as any)).toBe(false)
    })

    test('should reject session ID with insufficient entropy', () => {
      // A simple string with low entropy
      const lowEntropyId = 'aaaaaaaaaaaaaaaa'
      expect(sessionManager.validateSessionId(lowEntropyId)).toBe(false)
    })

    test('should reject non-string session ID', () => {
      expect(sessionManager.validateSessionId(12345 as any)).toBe(false)
    })
  })

  describe('createSession', () => {
    test('should create a new session', () => {
      const targetUrl = 'http://backend:3000'
      const session = sessionManager.createSession(targetUrl)

      expect(session).toBeDefined()
      expect(session.id).toBeDefined()
      expect(session.targetUrl).toBe(targetUrl)
      expect(session.createdAt).toBeDefined()
      expect(session.expiresAt).toBeDefined()
      expect(session.expiresAt).toBeGreaterThan(session.createdAt)
    })

    test('should create session with metadata', () => {
      const targetUrl = 'http://backend:3000'
      const metadata = { userId: '123', role: 'admin' }
      const session = sessionManager.createSession(targetUrl, metadata)

      expect(session.metadata).toEqual(metadata)
    })

    test('should create session with correct TTL', () => {
      const ttl = 1800000 // 30 minutes
      const manager = new SessionManager({ ttl })
      const session = manager.createSession('http://backend:3000')

      const expectedExpiry = session.createdAt + ttl
      expect(session.expiresAt).toBe(expectedExpiry)
      manager.destroy()
    })

    test('should store created session', () => {
      const session = sessionManager.createSession('http://backend:3000')
      const retrieved = sessionManager.getSession(session.id)

      expect(retrieved).toEqual(session)
    })
  })

  describe('getSession', () => {
    test('should retrieve an existing session', () => {
      const session = sessionManager.createSession('http://backend:3000')
      const retrieved = sessionManager.getSession(session.id)

      expect(retrieved).toEqual(session)
    })

    test('should return null for non-existent session', () => {
      const retrieved = sessionManager.getSession('non-existent-id')
      expect(retrieved).toBeNull()
    })

    test('should return null for expired session', () => {
      const manager = new SessionManager({ ttl: 100 }) // 100ms TTL
      const session = manager.createSession('http://backend:3000')

      // Wait for session to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const retrieved = manager.getSession(session.id)
          expect(retrieved).toBeNull()
          manager.destroy()
          resolve()
        }, 150)
      })
    })

    test('should return null for invalid session ID', () => {
      const retrieved = sessionManager.getSession('invalid-low-entropy-id')
      expect(retrieved).toBeNull()
    })

    test('should delete expired session when accessed', () => {
      const manager = new SessionManager({ ttl: 100 })
      const session = manager.createSession('http://backend:3000')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          manager.getSession(session.id)
          expect(manager.getSessionCount()).toBe(0)
          manager.destroy()
          resolve()
        }, 150)
      })
    })
  })

  describe('refreshSession', () => {
    test('should refresh an existing session', () => {
      const session = sessionManager.createSession('http://backend:3000')
      const originalExpiry = session.expiresAt

      // Wait a bit then refresh
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const refreshed = sessionManager.refreshSession(session.id)
          expect(refreshed).toBe(true)

          const updated = sessionManager.getSession(session.id)
          expect(updated!.expiresAt).toBeGreaterThan(originalExpiry)
          resolve()
        }, 50)
      })
    })

    test('should return false for non-existent session', () => {
      const refreshed = sessionManager.refreshSession('non-existent-id')
      expect(refreshed).toBe(false)
    })

    test('should return false for expired session', () => {
      const manager = new SessionManager({ ttl: 100 })
      const session = manager.createSession('http://backend:3000')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const refreshed = manager.refreshSession(session.id)
          expect(refreshed).toBe(false)
          manager.destroy()
          resolve()
        }, 150)
      })
    })
  })

  describe('deleteSession', () => {
    test('should delete an existing session', () => {
      const session = sessionManager.createSession('http://backend:3000')
      sessionManager.deleteSession(session.id)

      const retrieved = sessionManager.getSession(session.id)
      expect(retrieved).toBeNull()
    })

    test('should handle deleting non-existent session gracefully', () => {
      expect(() => {
        sessionManager.deleteSession('non-existent-id')
      }).not.toThrow()
    })
  })

  describe('cleanupExpiredSessions', () => {
    test('should clean up expired sessions', () => {
      const manager = new SessionManager({ ttl: 100 })

      // Create multiple sessions
      manager.createSession('http://backend1:3000')
      manager.createSession('http://backend2:3000')
      manager.createSession('http://backend3:3000')

      expect(manager.getSessionCount()).toBe(3)

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const cleaned = manager.cleanupExpiredSessions()
          expect(cleaned).toBe(3)
          expect(manager.getSessionCount()).toBe(0)
          manager.destroy()
          resolve()
        }, 150)
      })
    })

    test('should not clean up active sessions', () => {
      sessionManager.createSession('http://backend1:3000')
      sessionManager.createSession('http://backend2:3000')

      const cleaned = sessionManager.cleanupExpiredSessions()
      expect(cleaned).toBe(0)
      expect(sessionManager.getSessionCount()).toBe(2)
    })

    test('should return count of cleaned sessions', () => {
      const manager = new SessionManager({ ttl: 100 })
      manager.createSession('http://backend:3000')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const cleaned = manager.cleanupExpiredSessions()
          expect(cleaned).toBeGreaterThan(0)
          manager.destroy()
          resolve()
        }, 150)
      })
    })
  })

  describe('cookie handling', () => {
    test('should generate cookie header with secure attributes', () => {
      const sessionId = sessionManager.generateSessionId()
      const cookieHeader = sessionManager.generateCookieHeader(sessionId)

      expect(cookieHeader).toContain('bungate_session=')
      expect(cookieHeader).toContain('Secure')
      expect(cookieHeader).toContain('HttpOnly')
      expect(cookieHeader).toContain('SameSite=Strict')
      expect(cookieHeader).toContain('Path=/')
      expect(cookieHeader).toContain('Max-Age=')
    })

    test('should generate cookie with custom options', () => {
      const sessionId = sessionManager.generateSessionId()
      const cookieHeader = sessionManager.generateCookieHeader(sessionId, {
        domain: 'example.com',
        path: '/api',
        sameSite: 'lax',
      })

      expect(cookieHeader).toContain('Domain=example.com')
      expect(cookieHeader).toContain('Path=/api')
      expect(cookieHeader).toContain('SameSite=Lax')
    })

    test('should generate cookie with custom max-age', () => {
      const sessionId = sessionManager.generateSessionId()
      const cookieHeader = sessionManager.generateCookieHeader(sessionId, {
        maxAge: 7200,
      })

      expect(cookieHeader).toContain('Max-Age=7200')
    })

    test('should extract session ID from cookie header', () => {
      const sessionId = sessionManager.generateSessionId()
      const cookieHeader = `bungate_session=${sessionId}; Path=/`

      const extracted = sessionManager.extractSessionIdFromCookie(cookieHeader)
      expect(extracted).toBe(sessionId)
    })

    test('should extract session ID from multiple cookies', () => {
      const sessionId = sessionManager.generateSessionId()
      const cookieHeader = `other_cookie=value; bungate_session=${sessionId}; another=test`

      const extracted = sessionManager.extractSessionIdFromCookie(cookieHeader)
      expect(extracted).toBe(sessionId)
    })

    test('should return null when cookie not found', () => {
      const cookieHeader = 'other_cookie=value; another=test'
      const extracted = sessionManager.extractSessionIdFromCookie(cookieHeader)
      expect(extracted).toBeNull()
    })

    test('should return null for empty cookie header', () => {
      const extracted = sessionManager.extractSessionIdFromCookie(null)
      expect(extracted).toBeNull()
    })

    test('should extract session ID from request', () => {
      const sessionId = sessionManager.generateSessionId()
      const request = new Request('http://example.com', {
        headers: {
          Cookie: `bungate_session=${sessionId}`,
        },
      })

      const extracted = sessionManager.getSessionIdFromRequest(request)
      expect(extracted).toBe(sessionId)
    })
  })

  describe('getOrCreateSession', () => {
    test('should return existing session if valid', () => {
      const targetUrl = 'http://backend:3000'
      const session = sessionManager.createSession(targetUrl)

      const request = new Request('http://example.com', {
        headers: {
          Cookie: `bungate_session=${session.id}`,
        },
      })

      const retrieved = sessionManager.getOrCreateSession(request, targetUrl)
      expect(retrieved.id).toBe(session.id)
    })

    test('should create new session if none exists', () => {
      const request = new Request('http://example.com')
      const targetUrl = 'http://backend:3000'

      const session = sessionManager.getOrCreateSession(request, targetUrl)
      expect(session).toBeDefined()
      expect(session.targetUrl).toBe(targetUrl)
    })

    test('should create new session if existing is expired', () => {
      const manager = new SessionManager({ ttl: 100 })
      const targetUrl = 'http://backend:3000'
      const oldSession = manager.createSession(targetUrl)

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const request = new Request('http://example.com', {
            headers: {
              Cookie: `bungate_session=${oldSession.id}`,
            },
          })

          const newSession = manager.getOrCreateSession(request, targetUrl)
          expect(newSession.id).not.toBe(oldSession.id)
          manager.destroy()
          resolve()
        }, 150)
      })
    })

    test('should refresh existing session', () => {
      const targetUrl = 'http://backend:3000'
      const session = sessionManager.createSession(targetUrl)
      const originalExpiry = session.expiresAt

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const request = new Request('http://example.com', {
            headers: {
              Cookie: `bungate_session=${session.id}`,
            },
          })

          sessionManager.getOrCreateSession(request, targetUrl)
          const updated = sessionManager.getSession(session.id)
          expect(updated!.expiresAt).toBeGreaterThan(originalExpiry)
          resolve()
        }, 50)
      })
    })
  })

  describe('integration with load balancer', () => {
    test('should generate session IDs compatible with load balancer requirements', () => {
      // Load balancer requires minimum 128 bits of cryptographic entropy
      const sessionId = sessionManager.generateSessionId()
      // 128 bits = 16 bytes = 32 hex characters minimum
      expect(sessionId.length).toBeGreaterThanOrEqual(32)
      // Should be cryptographically random hex string
      expect(/^[0-9a-f]+$/i.test(sessionId)).toBe(true)
      // Should pass validation
      expect(sessionManager.validateSessionId(sessionId)).toBe(true)
    })

    test('should support sticky session workflow', () => {
      const targetUrl = 'http://backend1:3000'

      // First request - create session
      const request1 = new Request('http://example.com')
      const session1 = sessionManager.getOrCreateSession(request1, targetUrl)

      // Second request - reuse session
      const request2 = new Request('http://example.com', {
        headers: {
          Cookie: `bungate_session=${session1.id}`,
        },
      })
      const session2 = sessionManager.getOrCreateSession(request2, targetUrl)

      expect(session2.id).toBe(session1.id)
      expect(session2.targetUrl).toBe(targetUrl)
    })

    test('should handle session expiration in load balancer context', () => {
      const manager = new SessionManager({ ttl: 100 })
      const targetUrl = 'http://backend:3000'

      const request1 = new Request('http://example.com')
      const session1 = manager.getOrCreateSession(request1, targetUrl)

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const request2 = new Request('http://example.com', {
            headers: {
              Cookie: `bungate_session=${session1.id}`,
            },
          })
          const session2 = manager.getOrCreateSession(request2, targetUrl)

          // Should create new session since old one expired
          expect(session2.id).not.toBe(session1.id)
          manager.destroy()
          resolve()
        }, 150)
      })
    })
  })

  describe('resource cleanup', () => {
    test('should stop cleanup interval on destroy', () => {
      const manager = new SessionManager()
      manager.destroy()

      // After destroy, cleanup should not run
      expect(manager.getSessionCount()).toBe(0)
    })

    test('should clear all sessions on destroy', () => {
      const manager = new SessionManager()
      manager.createSession('http://backend1:3000')
      manager.createSession('http://backend2:3000')

      expect(manager.getSessionCount()).toBe(2)
      manager.destroy()
      expect(manager.getSessionCount()).toBe(0)
    })
  })
})
