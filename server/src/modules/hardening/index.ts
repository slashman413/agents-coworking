// Increment 5 (Hardening) — exports for rate limiting and license key modules.
export { InMemoryRateLimiter } from './rate-limiting/store.js'
export { rateLimit, rateLimitRule, limiter, checkDownloadRateLimit, getLimiterStatus } from './rate-limiting/middleware.js'
export type { RateLimitConfig, RateLimitResult, RateLimitRule } from './rate-limiting/types.js'
export { RateLimitTiers, DownloadRateLimit, LicenseVerifyRateLimit } from './rate-limiting/types.js'

export { LicenseStore } from './license-keys/database.js'
export type { LicenseKeyRow, CreateLicenseOptions, LicenseAuditRow } from './license-keys/database.js'
export { generateKey, verifySignature, parseKey, batchGenerate, extractKeys } from './license-keys/crypto.js'
export type { LicenseKeyConfig, LicenseKey, LicenseKeyPayload, VerifiedLicense } from './license-keys/crypto.js'