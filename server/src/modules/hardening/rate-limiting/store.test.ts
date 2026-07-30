// Unit tests for the rate limiting module.
// Tests the fixed-window rate limiter's behavior: allow, reject, reset, headers.

import test, { describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryRateLimiter } from './store.js'
import type { RateLimitConfig } from './types.js'

// Helper to create a fresh config for each test
function makeConfig(overrides: Partial<RateLimitConfig> = {}): RateLimitConfig {
  return { windowSeconds: 60, maxRequests: 5, keyPrefix: 'test', ...overrides }
}

describe('InMemoryRateLimiter — check()', () => {
  test('allows requests within the limit', () => {
    const limiter = new InMemoryRateLimiter()
    const config = makeConfig({ maxRequests: 5 })

    for (let i = 0; i < 5; i++) {
      const result = limiter.check(config, 'user1')
      assert.strictEqual(result.allowed, true)
      assert.strictEqual(result.currentCount, i + 1)
      assert.strictEqual(result.maxRequests, 5)
      assert.ok(result.resetSeconds > 0)
    }
  })

  test('rejects requests exceeding the limit', () => {
    const limiter = new InMemoryRateLimiter()
    const config = makeConfig({ maxRequests: 3 })

    for (let i = 0; i < 3; i++) {
      limiter.check(config, 'user1')
    }

    const result = limiter.check(config, 'user1')
    assert.strictEqual(result.allowed, false)
    assert.strictEqual(result.currentCount, 4)
    assert.strictEqual(result.maxRequests, 3)
    assert.ok((result.retryAfterSeconds ?? 0) > 0)
  })

  test('tracks different identifiers separately', () => {
    const limiter = new InMemoryRateLimiter()
    const config = makeConfig({ maxRequests: 2 })

    // Exhaust user1's limit
    limiter.check(config, 'user1') // count 1
    limiter.check(config, 'user1') // count 2 (max reached)
    assert.strictEqual(limiter.check(config, 'user1').allowed, false)

    // user2 should still have full capacity — independent counter
    const u2r1 = limiter.check(config, 'user2')
    assert.strictEqual(u2r1.allowed, true)
    assert.strictEqual(u2r1.currentCount, 1)
    assert.strictEqual(u2r1.maxRequests, 2)

    // user2 second request should be count 2
    const u2r2 = limiter.check(config, 'user2')
    assert.strictEqual(u2r2.allowed, true)
    assert.strictEqual(u2r2.currentCount, 2)

    // user2 third request should now be blocked
    const u2r3 = limiter.check(config, 'user2')
    assert.strictEqual(u2r3.allowed, false)
  })

  test('resets after window expires (mocked time)', () => {
    const limiter = new InMemoryRateLimiter()
    const originalNow = Date.now
    let mockNow = 1000000

    // @ts-ignore
    global.Date.now = () => mockNow

    try {
      const config = makeConfig({ windowSeconds: 60, maxRequests: 2 })

      // Exhaust limit
      limiter.check(config, 'user1')
      limiter.check(config, 'user1')
      assert.strictEqual(limiter.check(config, 'user1').allowed, false)

      // Advance past window
      mockNow = 1000000 + 61000

      // Should be allowed in new window with count 1
      const result = limiter.check(config, 'user1')
      assert.strictEqual(result.allowed, true)
      assert.strictEqual(result.currentCount, 1)
    } finally {
      // @ts-ignore
      global.Date.now = originalNow
    }
  })

  test('increments count on each check call', () => {
    const limiter = new InMemoryRateLimiter()
    const config = makeConfig({ maxRequests: 100 })

    let prevCount = 0
    for (let i = 0; i < 5; i++) {
      const result = limiter.check(config, 'user1')
      assert.strictEqual(result.currentCount, prevCount + 1)
      prevCount = result.currentCount
    }
  })
})

describe('InMemoryRateLimiter — reset()', () => {
  test('resets a specific identifier', () => {
    const limiter = new InMemoryRateLimiter()
    const config = makeConfig({ maxRequests: 2 })

    // Exhaust user1
    limiter.check(config, 'user1')
    limiter.check(config, 'user1')
    assert.strictEqual(limiter.check(config, 'user1').allowed, false)

    // Reset
    limiter.reset('user1', 'test')

    // Should be allowed again starting at count 1
    const result = limiter.check(config, 'user1')
    assert.strictEqual(result.allowed, true)
    assert.strictEqual(result.currentCount, 1)
  })
})

describe('InMemoryRateLimiter — clear()', () => {
  test('clears all entries', () => {
    const limiter = new InMemoryRateLimiter()
    const config = makeConfig({ maxRequests: 2 })

    limiter.check(config, 'user1')
    limiter.check(config, 'user2')
    limiter.check(config, 'user3')
    assert.strictEqual(limiter.size(), 3)

    limiter.clear()
    assert.strictEqual(limiter.size(), 0)

    // All users should be fresh
    assert.strictEqual(limiter.check(config, 'user1').currentCount, 1)
    assert.strictEqual(limiter.check(config, 'user2').currentCount, 1)
  })
})

describe('InMemoryRateLimiter — size()', () => {
  test('returns number of active rate limit entries', () => {
    const limiter = new InMemoryRateLimiter()
    const config = makeConfig({ maxRequests: 2 })

    assert.strictEqual(limiter.size(), 0)

    limiter.check(config, 'user1')
    assert.strictEqual(limiter.size(), 1)

    limiter.check(config, 'user2')
    assert.strictEqual(limiter.size(), 2)

    limiter.check(config, 'user3')
    assert.strictEqual(limiter.size(), 3)
  })
})