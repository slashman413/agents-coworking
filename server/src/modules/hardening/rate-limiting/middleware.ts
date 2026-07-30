// Rate limiting middleware for Express.
// Integrates the InMemoryRateLimiter with Express request handling.
// Adds standard rate-limit headers (X-RateLimit-*) and returns
// a 429 response when a client exceeds their quota.

import type { Request, Response, NextFunction } from 'express'
import { InMemoryRateLimiter } from './store.js'
import type { RateLimitConfig, RateLimitResult, RateLimitRule } from './types.js'

export const limiter = new InMemoryRateLimiter()

/**
 * Attach rate limit headers to the response.
 */
function attachHeaders(res: Response, result: RateLimitResult): void {
  res.set('X-RateLimit-Limit', String(result.maxRequests))
  res.set('X-RateLimit-Remaining', String(Math.max(0, result.maxRequests - result.currentCount)))
  res.set('X-RateLimit-Reset', String(Date.now() / 1000 + result.resetSeconds))

  if (!result.allowed && result.retryAfterSeconds) {
    res.set('Retry-After', String(result.retryAfterSeconds))
  }
}

/**
 * Create an Express middleware from a rate limit config.
 *
 * The identifier is derived from:
 *  1. A custom `req.rateLimitId` if set (e.g., after auth)
 *  2. The X-Forwarded-For header (behind proxy)
 *  3. The socket remote address
 */
export function rateLimit(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (config.skip) {
      return next()
    }

    const identifier =
      (req as Request & { rateLimitId?: string }).rateLimitId ||
      req.ip ||
      req.get('X-Forwarded-For') ||
      req.socket.remoteAddress ||
      'unknown'

    const result = limiter.check(config, identifier)
    attachHeaders(res, result)

    if (!result.allowed) {
      res.status(429).json({
        error: 'too_many_requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: result.retryAfterSeconds,
        limit: config.maxRequests,
        windowSeconds: config.windowSeconds,
      })
      return
    }

    next()
  }
}

/**
 * Create an Express middleware from a full RateLimitRule.
 */
export function rateLimitRule(rule: RateLimitRule) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (rule.config.skip) {
      return next()
    }

    const identifier =
      (req as Request & { rateLimitId?: string }).rateLimitId ||
      req.ip ||
      req.get('X-Forwarded-For') ||
      req.socket.remoteAddress ||
      'unknown'

    const result = limiter.check(rule.config, identifier)
    attachHeaders(res, result)

    if (!result.allowed) {
      res.status(rule.statusCode || 429).json({
        error: 'rate_limit_exceeded',
        rule: rule.name,
        message: rule.errorMessage || `Rate limit exceeded for rule "${rule.name}".`,
        retryAfter: result.retryAfterSeconds,
        details: {
          limit: rule.config.maxRequests,
          windowSeconds: rule.config.windowSeconds,
        },
      })
      return
    }

    next()
  }
}

/**
 * Check download rate limits for an entitlement.
 * Returns { allowed, result } so the calling route can decide the response.
 */
export function checkDownloadRateLimit(
  entitlementEmail: string,
  assetVersion: string
): { allowed: boolean; result: RateLimitResult } {
  // Per entitlement + asset version, to prevent re-downloading the same file abuse
  const identifier = `${entitlementEmail}:${assetVersion}`
  const result = limiter.check({
    windowSeconds: 3600,
    maxRequests: 10,
    keyPrefix: 'download',
  }, identifier)
  return { allowed: result.allowed, result }
}

/**
 * Verify and reset the rate limiter state for monitoring.
 */
export function getLimiterStatus(): { entries: number; cleared: boolean } {
  const entries = limiter.size()
  return { entries, cleared: false }
}