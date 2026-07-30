// License key generation and verification for Increment 5 (Hardening).
//
// License keys are used to gate access to downloadable digital products.
// Each key is:
//  1. Cryptographically signed (HMAC-SHA256) to prevent forgery
//  2. Structured with a prefix that encodes the product tier
//  3. Tracked in the database for activation limits and revocation
//
// Key format: {PREFIX}:{TIMESTAMP_HEX}:{RANDOM_HEX}:{HMAC_SIGNATURE}
// Example: FPA-PRO:17d6e0c5a3f:a3f7b2c1d4e5f6a7b8c9d0e1f2a3b4c5:8f3a...c7d2
//
// We use ':' as the delimiter (not '-') so that prefixes like 'FPA-PRO'
// or 'CUSTOM-AGENCY' don't get split on demarcation.

import { randomBytes, createHmac } from 'node:crypto'

export interface LicenseKeyConfig {
  /** Secret key for HMAC signing (use environment variable) */
  secret: string
  /** Prefix for the license key (e.g., 'FPA-PRO') */
  prefix: string
  /** Entropy bytes in the random portion (default 16 = 32 hex chars) */
  entropyBytes?: number
}

export interface LicenseKeyPayload {
  prefix: string
  timestamp: number
  randomId: string
}

export interface LicenseKey extends LicenseKeyPayload {
  signature: string
  raw: string
}

export interface VerifiedLicense {
  valid: boolean
  payload?: LicenseKeyPayload
  error?: string
}

const DELIM = ':'

/**
 * Generate a cryptographically signed license key.
 *
 * The key structure:
 *  {PREFIX}:{TIMESTAMP_HEX}:{RANDOM_HEX}:{HMAC_SIGNATURE}
 *
 * HMAC signs the payload portion (everything except the signature),
 * preventing tampering of any field.
 */
export function generateKey(config: LicenseKeyConfig): LicenseKey {
  const { secret, prefix, entropyBytes = 16 } = config

  const timestamp = Date.now()
  const timestampHex = timestamp.toString(16)
  const randomBytesHex = randomBytes(entropyBytes).toString('hex')

  // HMAC signs the payload portion (everything except the signature)
  const payload = `${prefix}${DELIM}${timestampHex}${DELIM}${randomBytesHex}`
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex')

  const raw = `${payload}${DELIM}${signature}`

  return {
    prefix,
    timestamp,
    randomId: randomBytesHex,
    signature,
    raw,
  }
}

/**
 * Verify a license key's cryptographic signature and structural validity.
 *
 * Returns { valid: true, payload } if the key is structurally valid and
 * the HMAC matches. Returns { valid: false, error } otherwise.
 *
 * Does NOT check the database — that's the caller's responsibility
 * (activation count, revocation status, etc.).
 */
export function verifySignature(keyRaw: string, config: LicenseKeyConfig): VerifiedLicense {
  const parts = keyRaw.split(DELIM)

  // Expected: PREFIX:TIMESTAMP_HEX:RANDOM_HEX:SIGNATURE (4 segments)
  if (parts.length < 4) {
    return { valid: false, error: 'Invalid key format: too few segments' }
  }

  // Last segment is signature; everything before is payload
  const signature = parts[parts.length - 1]
  const payload = parts.slice(0, -1).join(DELIM)

  // Verify HMAC
  const expectedSig = createHmac('sha256', config.secret)
    .update(payload)
    .digest('hex')

  if (signature !== expectedSig) {
    return { valid: false, error: 'Invalid key signature' }
  }

  // Parse the payload back into components
  // The payload is: PREFIX:TIMESTAMP_HEX:RANDOM_HEX
  // We know the last 2 segments are timestamp (hex) and random (hex),
  // so the prefix is everything before the last 2 segments.
  if (parts.length < 4) {
    return { valid: false, error: 'Invalid key structure after signature verification' }
  }

  const rawParts = keyRaw.split(DELIM)
  const randomId = rawParts[rawParts.length - 2]
  const timestampHex = rawParts[rawParts.length - 3]
  const prefix = rawParts.slice(0, -3).join(DELIM)

  // Validate timestamp is parseable
  const timestamp = parseInt(timestampHex, 16)
  if (isNaN(timestamp)) {
    return { valid: false, error: 'Invalid timestamp in key' }
  }

  // Check if the key is expired (configurable, default 1 year)
  // Note: generateKey stores timestamp as Date.now() (ms), so no conversion needed
  const ageMs = Date.now() - timestamp
  const maxAgeMs = 365 * 24 * 60 * 60 * 1000 // 1 year
  if (ageMs > maxAgeMs) {
    return { valid: false, error: 'Key has expired' }
  }

  return {
    valid: true,
    payload: {
      prefix,
      timestamp,
      randomId,
    },
  }
}

/**
 * Parse a license key string into its components (without verification).
 * Useful for logging and analytics.
 */
export function parseKey(keyRaw: string): LicenseKeyPayload | null {
  const parts = keyRaw.split(DELIM)
  if (parts.length < 4) return null

  // Same structure: PREFIX:TIMESTAMP_HEX:RANDOM_HEX:SIGNATURE
  // prefix may contain delimiters, so it's everything before the last 3 segments
  const randomId = parts[parts.length - 2]
  const timestampHex = parts[parts.length - 3]
  const prefix = parts.slice(0, -3).join(DELIM)
  const timestamp = parseInt(timestampHex, 16)

  if (isNaN(timestamp)) return null

  return { prefix, timestamp, randomId }
}

/**
 * Batch-generate license keys for a product.
 */
export function batchGenerate(config: LicenseKeyConfig, count: number): string[] {
  const keys: string[] = []
  for (let i = 0; i < count; i++) {
    keys.push(generateKey(config).raw)
  }
  return keys
}

/**
 * Extract all valid license keys from a string (one per line, comma-separated, or space-separated).
 */
export function extractKeys(input: string): string[] {
  return input
    .split(/[\s,\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 20) // Basic sanity: valid keys are long
}