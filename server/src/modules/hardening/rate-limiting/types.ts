// Rate limiting type definitions for Increment 5 (Hardening)

export interface RateLimitConfig {
  /** Window duration in seconds */
  windowSeconds: number
  /** Maximum requests allowed in the window */
  maxRequests: number
  /** Custom key prefix for grouping */
  keyPrefix?: string
  /** Whether to skip rate limiting (e.g., for admin/internal) */
  skip?: boolean
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Current request count in window */
  currentCount: number
  /** Maximum allowed in window */
  maxRequests: number
  /** Seconds until the window resets */
  resetSeconds: number
  /** Retry-After header value (seconds, only when blocked) */
  retryAfterSeconds?: number
}

export interface RateLimitRule {
  /** Unique identifier for this rule */
  name: string
  /** The configuration */
  config: RateLimitConfig
  /** HTTP status to return when blocked (default 429) */
  statusCode?: number
  /** Custom error message body when blocked */
  errorMessage?: string
}

// Predefined rate limit tiers matching the architecture
export const RateLimitTiers = {
  /** Anonymous / unauthenticated users — strictest */
  anonymous: {
    windowSeconds: 60,
    maxRequests: 30,
    keyPrefix: 'anon',
  } as RateLimitConfig,

  /** Authenticated users — moderate */
  authenticated: {
    windowSeconds: 60,
    maxRequests: 120,
    keyPrefix: 'auth',
  } as RateLimitConfig,

  /** API consumers (license-keyed) — generous */
  apiKey: {
    windowSeconds: 60,
    maxRequests: 300,
    keyPrefix: 'api',
  } as RateLimitConfig,

  /** Internal / admin — very permissive */
  internal: {
    windowSeconds: 60,
    maxRequests: 1000,
    keyPrefix: 'internal',
  } as RateLimitConfig,
} as const

// Download-specific rate limiting
export const DownloadRateLimit = {
  windowSeconds: 3600, // 1 hour
  maxRequests: 10, // 10 downloads per hour per entitlement
  keyPrefix: 'download',
} as RateLimitConfig

// License verification rate limiting (strict to prevent brute-force)
export const LicenseVerifyRateLimit = {
  windowSeconds: 300, // 5 minutes
  maxRequests: 10, // 10 attempts per 5 minutes per IP
  keyPrefix: 'license_verify',
} as RateLimitConfig