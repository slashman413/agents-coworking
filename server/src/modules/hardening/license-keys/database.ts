// License key database service layer.
//
// Uses an in-memory store (Map-based) that mirrors the Postgres schema
// from the architecture document. This is appropriate for Increment 5
// prototyping and aligns with the architecture's stance (A2: solo operator,
// serverless where each instance has its own memory).
//
// Production: swap the Map for a Postgres-backed query layer.
// The API surface of LicenseStore remains identical.
//
// Responsibilities:
//  1. Insert new license keys
//  2. Verify keys (crypto + DB lookup + expiry check)
//  3. Track activations with concurrency-safe updates
//  4. Manage lifecycle (activate, revoke, expiry cleanup)
//  5. Audit logging for fraud detection

import { randomBytes, createHash } from 'node:crypto'
import { generateKey, verifySignature, type LicenseKeyConfig, type VerifiedLicense } from './crypto.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LicenseKeyRow {
  id: string
  key: string
  product_id: string
  entitlement_id: string
  customer_email: string
  tier: string
  status: 'active' | 'used' | 'revoked' | 'expired'
  activation_cap: number | null
  activations: number
  activated_at: string | null  // ISO 8601 or null
  expires_at: string | null     // ISO 8601 or null
  revoked_at: string | null
  created_at: string
  updated_at: string
}

export interface CreateLicenseOptions {
  productId: string
  entitlementId: string
  customerEmail: string
  tier?: string
  activationCap?: number | null
  expiresAt?: Date | null
}

export interface LicenseAuditRow {
  id: string
  key_fingerprint: string
  customer_email: string | null
  action: string
  result: string
  ip_hash: string | null
  user_agent_hash: string | null
  metadata: string | null
  at: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a 16-char hex fingerprint of a key (sha256 prefix). */
function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

/** Hash an arbitrary string value. */
function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// ---------------------------------------------------------------------------
// In-memory license store
// ---------------------------------------------------------------------------

export class LicenseStore {
  private byKey = new Map<string, LicenseKeyRow>()  // raw_key -> row (for verify/activate)
  private byId  = new Map<string, LicenseKeyRow>()  // id -> row (for email/product queries)
  private byEmail = new Map<string, string[]>() // email -> [id...]
  private byProduct = new Map<string, string[]>() // product_id -> [id...]
  // Audit log (append-only, bounded)
  private auditLog: LicenseAuditRow[] = []

  /** Create a new license key and store it. */
  create(config: LicenseKeyConfig, options: CreateLicenseOptions): string {
    const { productId, entitlementId, customerEmail, tier = 'pro', activationCap, expiresAt } = options
    const now = new Date().toISOString()
    const keyData = generateKey(config)
    const id = randomBytes(16).toString('hex')

    const row: LicenseKeyRow = {
      id,
      key: keyData.raw,
      product_id: productId,
      entitlement_id: entitlementId,
      customer_email: customerEmail,
      tier,
      status: 'active',
      activation_cap: activationCap ?? null,
      activations: 0,
      activated_at: null,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      revoked_at: null,
      created_at: now,
      updated_at: now,
    }

    this.byKey.set(row.key, row)
    this.byId.set(id, row)

    // Update indexes
    if (!this.byEmail.has(customerEmail)) this.byEmail.set(customerEmail, [])
    this.byEmail.get(customerEmail)!.push(id)

    if (!this.byProduct.has(productId)) this.byProduct.set(productId, [])
    this.byProduct.get(productId)!.push(id)

    // Audit
    this._logAudit({
      key_fingerprint: keyFingerprint(row.key),
      customer_email: customerEmail,
      action: 'create',
      result: 'success',
      ip_hash: null,
      user_agent_hash: null,
      metadata: null,
    })

    return keyData.raw
  }

  /**
   * Verify a license key. Three-layer check:
   * 1. Cryptographic signature (prevent forgery)
   * 2. DB lookup (key exists, is active)
   * 3. Expiry check (if set)
   */
  verify(config: LicenseKeyConfig, keyRaw: string): VerifiedLicense & { license?: LicenseKeyRow } {
    // Layer 1: Crypto
    const cryptoResult = verifySignature(keyRaw, config)
    if (!cryptoResult.valid) {
      this._logAudit({
        key_fingerprint: keyFingerprint(keyRaw),
        customer_email: null,
        action: 'verify',
        result: 'failed',
        ip_hash: null,
        user_agent_hash: null,
        metadata: JSON.stringify({ error_reason: cryptoResult.error }),
      })
      return { valid: false, error: cryptoResult.error }
    }

    // Layer 2: DB lookup
    const row = this.byKey.get(keyRaw)
    if (!row || row.status !== 'active') {
      this._logAudit({
        key_fingerprint: keyFingerprint(keyRaw),
        customer_email: null,
        action: 'verify',
        result: 'failed',
        ip_hash: null,
        user_agent_hash: null,
        metadata: JSON.stringify({ error_reason: 'key_not_found_or_revoked' }),
      })
      return { valid: false, error: 'Invalid or revoked license key' }
    }

    // Layer 3: Expiry
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      // Auto-transition to expired
      row.status = 'expired'
      row.revoked_at = new Date().toISOString()
      row.updated_at = new Date().toISOString()

      this._logAudit({
        key_fingerprint: keyFingerprint(keyRaw),
        customer_email: row.customer_email,
        action: 'verify',
        result: 'failed',
        ip_hash: null,
        user_agent_hash: null,
        metadata: JSON.stringify({ error_reason: 'key_expired' }),
      })
      return { valid: false, error: 'License key has expired' }
    }

    // All checks passed
    this._logAudit({
      key_fingerprint: keyFingerprint(keyRaw),
      customer_email: row.customer_email,
      action: 'verify',
      result: 'success',
      ip_hash: null,
      user_agent_hash: null,
      metadata: JSON.stringify({ license_id: row.id, tier: row.tier, activations: row.activations }),
    })

    return { valid: true, license: row }
  }

  /**
   * Activate a license key.
   * Thread-safe for in-memory: JS is single-threaded, so concurrent
   * activations can't race. For multi-process (multiple Lambda instances),
   * this would need Redis or DB-level row locking.
   */
  activate(
    keyRaw: string,
    ipAddress: string,
    userAgent: string
  ): { success: boolean; error?: string; activationCount?: number; license?: LicenseKeyRow } {
    const row = this.byKey.get(keyRaw)
    if (!row || row.status !== 'active') {
      this._logAudit({
        key_fingerprint: keyFingerprint(keyRaw),
        customer_email: null,
        action: 'activate',
        result: 'failed',
        ip_hash: hashValue(ipAddress),
        user_agent_hash: hashValue(userAgent),
        metadata: JSON.stringify({ error_reason: 'key_not_found' }),
      })
      return { success: false, error: 'License key not found' }
    }

    // Check activation cap
    if (row.activation_cap !== null && row.activations >= row.activation_cap) {
      this._logAudit({
        key_fingerprint: keyFingerprint(keyRaw),
        customer_email: row.customer_email,
        action: 'activate',
        result: 'failed',
        ip_hash: hashValue(ipAddress),
        user_agent_hash: hashValue(userAgent),
        metadata: JSON.stringify({ error_reason: 'activation_cap_reached', activation_cap: row.activation_cap }),
      })
      return { success: false, error: 'Activation limit reached' }
    }

    // Increment activation count
    const newCount = row.activations + 1
    row.activations = newCount
    row.activated_at = new Date().toISOString()
    row.updated_at = new Date().toISOString()

    this._logAudit({
      key_fingerprint: keyFingerprint(keyRaw),
      customer_email: row.customer_email,
      action: 'activate',
      result: 'success',
      ip_hash: hashValue(ipAddress),
      user_agent_hash: hashValue(userAgent),
      metadata: JSON.stringify({ license_id: row.id, activation_count: newCount }),
    })

    return { success: true, activationCount: newCount, license: row }
  }

  /** Revoke a license key. */
  revoke(keyRaw: string, reason: string): { success: boolean; error?: string; email?: string } {
    const row = this.byKey.get(keyRaw)
    if (!row || row.status !== 'active') {
      return { success: false, error: 'Key not found or already revoked' }
    }

    const email = row.customer_email
    row.status = 'revoked'
    row.revoked_at = new Date().toISOString()
    row.updated_at = new Date().toISOString()

    this._logAudit({
      key_fingerprint: keyFingerprint(keyRaw),
      customer_email: email,
      action: 'revoke',
      result: 'success',
      ip_hash: null,
      user_agent_hash: null,
      metadata: JSON.stringify({ reason }),
    })

    return { success: true, email }
  }

  /** Get audit log entries for investigation. */
  getAuditLog(keyOrEmail: string): LicenseAuditRow[] {
    const prefix = keyOrEmail.slice(0, 8)
    return this.auditLog.filter(
      log =>
        log.key_fingerprint.startsWith(prefix) ||
        log.customer_email === keyOrEmail
    ).slice(0, 100)
  }

  /** Get all active licenses for a customer. */
  getByEmail(email: string): LicenseKeyRow[] {
    const ids = this.byEmail.get(email)
    if (!ids) return []
    return ids
      .map(id => this.byId.get(id))
      .filter((r): r is LicenseKeyRow => r !== undefined && r.status === 'active')
  }

  /** Get all active licenses for a product. */
  getByProduct(productId: string): LicenseKeyRow[] {
    const ids = this.byProduct.get(productId)
    if (!ids) return []
    return ids
      .map(id => this.byId.get(id))
      .filter((r): r is LicenseKeyRow => r !== undefined && r.status === 'active')
  }

  /** Count active licenses. */
  countActive(): number {
    let count = 0
    for (const row of this.byKey.values()) {
      if (row.status === 'active') count++
    }
    return count
  }

  /** Cleanup expired licenses (batch transition). */
  cleanupExpired(): number {
    let cleaned = 0
    const now = new Date().toISOString()
    for (const row of this.byKey.values()) {
      if (row.status === 'active' && row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
        row.status = 'expired'
        row.revoked_at = now
        row.updated_at = now
        cleaned++
      }
    }
    return cleaned
  }

  // -- Private --

  private _logAudit(log: {
    key_fingerprint: string
    customer_email: string | null
    action: string
    result: string
    ip_hash: string | null
    user_agent_hash: string | null
    metadata: string | null
  }): void {
    this.auditLog.push({
      id: randomBytes(16).toString('hex'),
      ...log,
      at: new Date().toISOString(),
    })
    // Bound the log to prevent unbounded memory growth
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-5000)
    }
  }
}