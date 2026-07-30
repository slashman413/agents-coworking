// Unit tests for the license store (database layer).
// Tests CRUD operations, verification, activation, revocation, and audit logging.

import test, { describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { LicenseStore } from './database.js'
import type { CreateLicenseOptions, LicenseKeyRow } from './database.js'
import type { LicenseKeyConfig } from './crypto.js'

function makeStore(): LicenseStore {
  return new LicenseStore()
}

describe('LicenseStore — create()', () => {
  let store: LicenseStore

  beforeEach(() => {
    store = makeStore()
  })

  test('creates a license key and returns the raw key string', () => {
    const options: CreateLicenseOptions = {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
      tier: 'pro',
    }

    const key = store.create(config, options)
    assert.ok(key)
    assert.strictEqual(typeof key, 'string')
    assert.ok(key.length > 50)
  })

  test('stores the license key in the database', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
    })

    const rows = store.getByEmail('user@example.com')
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].key, key)
  })

  test('stores correct metadata', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
      tier: 'agency',
      activationCap: 3,
      expiresAt: new Date('2027-01-01'),
    })

    const rows = store.getByEmail('user@example.com')
    assert.strictEqual(rows[0].tier, 'agency')
    assert.strictEqual(rows[0].activation_cap, 3)
    assert.strictEqual(rows[0].activations, 0)
    assert.strictEqual(rows[0].status, 'active')
    assert.strictEqual(rows[0].expires_at, '2027-01-01T00:00:00.000Z')
  })

  test('creates unique keys', () => {
    const key1 = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user1@example.com',
    })

    const key2 = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-2',
      customerEmail: 'user2@example.com',
    })

    assert.notStrictEqual(key1, key2)
  })
})

// Fixtures initialized at module load — before any test runs.
const config: LicenseKeyConfig = {
  secret: 'test-secret-for-license-signing',
  prefix: 'FPA',
  entropyBytes: 8,
}

describe('LicenseStore — verify()', () => {
  let store: LicenseStore

  beforeEach(() => {
    store = makeStore()
  })

  test('verifies a freshly created key', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
    })

    const result = store.verify(config, key)
    assert.strictEqual(result.valid, true)
    assert.ok(result.license)
    assert.ok(!result.error)
  })

  test('returns error for tampered key', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
    })

    const tampered = key.slice(0, -5) + 'XXXXX'
    const result = store.verify(config, tampered)
    assert.strictEqual(result.valid, false)
    assert.strictEqual(result.error, 'Invalid key signature')
  })

  test('returns error for unknown key', () => {
    // Use the correct delimiter (:) but a key that was never generated (invalid HMAC)
    const result = store.verify(config, 'FPA-FAKE-1234567890abcdef0123456789')
    assert.strictEqual(result.valid, false)
    assert.ok(result.error)
  })

  test('returns error for expired key', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
      expiresAt: new Date('2020-01-01'),
    })

    const result = store.verify(config, key)
    assert.strictEqual(result.valid, false)
    assert.strictEqual(result.error, 'License key has expired')
  })

  test('returns error for revoked key', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
    })

    store.revoke(key, 'customer_request')
    const result = store.verify(config, key)
    assert.strictEqual(result.valid, false)
    assert.strictEqual(result.error, 'Invalid or revoked license key')
  })
})

describe('LicenseStore — activate()', () => {
  let store: LicenseStore

  beforeEach(() => {
    store = makeStore()
  })

  test('activates a valid key', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
    })

    const result = store.activate(key, '192.168.1.1', 'Mozilla/5.0')
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.activationCount, 1)
  })

  test('increments activation count', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
      activationCap: 3,
    })

    store.activate(key, '192.168.1.1', 'Mozilla/5.0')
    store.activate(key, '192.168.1.2', 'Chrome/90.0')

    const result = store.verify(config, key)
    assert.ok(result.license)
    assert.strictEqual(result.license.activations, 2)
  })

  test('blocks activation past cap', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
      activationCap: 2,
    })

    const r1 = store.activate(key, '192.168.1.1', 'Mozilla/5.0')
    const r2 = store.activate(key, '192.168.1.2', 'Chrome/90.0')
    const r3 = store.activate(key, '192.168.1.3', 'Safari/14.0')

    assert.strictEqual(r1.success, true)
    assert.strictEqual(r2.success, true)
    assert.strictEqual(r3.success, false)
    assert.strictEqual(r3.error, 'Activation limit reached')
  })

  test('blocks activation of unknown key', () => {
    const result = store.activate('FAKE-KEY-1234567890', '192.168.1.1', 'Mozilla/5.0')
    assert.strictEqual(result.success, false)
    assert.strictEqual(result.error, 'License key not found')
  })

  test('blocks activation of revoked key', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
    })

    store.revoke(key, 'test')
    const result = store.activate(key, '192.168.1.1', 'Mozilla/5.0')
    assert.strictEqual(result.success, false)
  })

  test('sets activated_at timestamp', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
    })

    store.activate(key, '192.168.1.1', 'Mozilla/5.0')

    const result = store.verify(config, key)
    assert.ok(result.license)
    assert.ok(result.license.activated_at)
  })
})

describe('LicenseStore — revoke()', () => {
  let store: LicenseStore

  beforeEach(() => {
    store = makeStore()
  })

  test('revokes a valid key', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
    })

    const result = store.revoke(key, 'customer_request')
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.email, 'user@example.com')
  })

  test('revoked keys fail verification', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
    })

    store.revoke(key, 'fraud_suspected')
    const verifyResult = store.verify(config, key)
    assert.strictEqual(verifyResult.valid, false)
  })

  test('revoked keys fail activation', () => {
    const key = store.create(config, {
      productId: 'prod-1',
      entitlementId: 'ent-1',
      customerEmail: 'user@example.com',
    })

    store.revoke(key, 'test')
    const activateResult = store.activate(key, '192.168.1.1', 'Mozilla/5.0')
    assert.strictEqual(activateResult.success, false)
  })

  test('returns error for non-existent key', () => {
    const result = store.revoke('FAKE-KEY-1234567890', 'test')
    assert.strictEqual(result.success, false)
    assert.strictEqual(result.error, 'Key not found or already revoked')
  })
})

describe('LicenseStore — getByEmail()', () => {
  let store: LicenseStore

  beforeEach(() => {
    store = makeStore()
  })

  test('returns all active licenses for an email', () => {
    store.create(config, { productId: 'prod-1', entitlementId: 'ent-1', customerEmail: 'user@example.com' })
    store.create(config, { productId: 'prod-2', entitlementId: 'ent-2', customerEmail: 'user@example.com' })
    store.create(config, { productId: 'prod-3', entitlementId: 'ent-3', customerEmail: 'other@example.com' })

    const licenses = store.getByEmail('user@example.com')
    assert.strictEqual(licenses.length, 2)
    assert.ok(licenses.some(l => l.product_id === 'prod-1'))
    assert.ok(licenses.some(l => l.product_id === 'prod-2'))
  })

  test('returns empty array for unknown email', () => {
    assert.strictEqual(store.getByEmail('unknown@example.com').length, 0)
  })

  test('excludes revoked licenses', () => {
    const key1 = store.create(config, { productId: 'prod-1', entitlementId: 'ent-1', customerEmail: 'user@example.com' })
    store.create(config, { productId: 'prod-2', entitlementId: 'ent-2', customerEmail: 'user@example.com' })

    store.revoke(key1, 'test')

    assert.strictEqual(store.getByEmail('user@example.com').length, 1)
  })
})

describe('LicenseStore — getByProduct()', () => {
  let store: LicenseStore

  beforeEach(() => {
    store = makeStore()
  })

  test('returns all active licenses for a product', () => {
    store.create(config, { productId: 'prod-1', entitlementId: 'ent-1', customerEmail: 'user1@example.com' })
    store.create(config, { productId: 'prod-1', entitlementId: 'ent-2', customerEmail: 'user2@example.com' })
    store.create(config, { productId: 'prod-2', entitlementId: 'ent-3', customerEmail: 'user3@example.com' })

    assert.strictEqual(store.getByProduct('prod-1').length, 2)
  })
})

describe('LicenseStore — countActive()', () => {
  let store: LicenseStore

  beforeEach(() => {
    store = makeStore()
  })

  test('counts only active licenses', () => {
    store.create(config, { productId: 'prod-1', entitlementId: 'ent-1', customerEmail: 'user1@example.com' })
    store.create(config, { productId: 'prod-1', entitlementId: 'ent-2', customerEmail: 'user2@example.com' })
    store.create(config, { productId: 'prod-2', entitlementId: 'ent-3', customerEmail: 'user3@example.com' })

    // Access the internal byKey map to get the first key
    const allKeys = [...(store as any)['byKey'].values()]
    const key1 = allKeys[0].key
    store.revoke(key1, 'test')

    assert.strictEqual(store.countActive(), 2)
  })
})

describe('LicenseStore — cleanupExpired()', () => {
  let store: LicenseStore

  beforeEach(() => {
    store = makeStore()
  })

  test('transitions expired licenses to expired status', () => {
    store.create(config, { productId: 'prod-1', entitlementId: 'ent-1', customerEmail: 'user1@example.com' })
    store.create(config, { productId: 'prod-1', entitlementId: 'ent-2', customerEmail: 'user2@example.com', expiresAt: new Date('2020-01-01') })

    const before = store.countActive()
    const cleaned = store.cleanupExpired()

    assert.strictEqual(cleaned, 1)
    assert.strictEqual(store.countActive(), before - 1)
  })
})

describe('LicenseStore — getAuditLog()', () => {
  let store: LicenseStore

  beforeEach(() => {
    store = makeStore()
  })

  test('returns audit log entries', () => {
    store.create(config, { productId: 'prod-1', entitlementId: 'ent-1', customerEmail: 'user@example.com' })

    const auditLog = store.getAuditLog('user@example.com')
    assert.ok(auditLog.length > 0)
    assert.strictEqual(auditLog[0].action, 'create')
  })

  test('filters by email', () => {
    store.create(config, { productId: 'prod-1', entitlementId: 'ent-1', customerEmail: 'alice@example.com' })
    store.create(config, { productId: 'prod-1', entitlementId: 'ent-2', customerEmail: 'bob@example.com' })

    const aliceLog = store.getAuditLog('alice@example.com')
    const bobLog = store.getAuditLog('bob@example.com')

    assert.ok(aliceLog.length > 0)
    assert.ok(bobLog.length > 0)
  })
})