// Unit tests for license key generation and verification.
// Tests cryptographic signing, signature verification, parsing, and batch generation.

import test, { describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  generateKey,
  verifySignature,
  parseKey,
  batchGenerate,
  extractKeys,
} from './crypto.js'

describe('License Key Generation & Verification', () => {
  let config: { secret: string; prefix: string; entropyBytes: number }

  beforeEach(() => {
    config = {
      secret: 'test-secret-key-for-hmac-signing',
      prefix: 'FPA-PRO',
      entropyBytes: 8,
    }
  })

  describe('generateKey()', () => {
    test('generates a valid license key string with correct structure', () => {
      const result = generateKey(config)

      assert.ok(result.raw.length > 50)
      assert.strictEqual(typeof result.raw, 'string')

      // Key format: PREFIX:TIMESTAMP_HEX:RANDOM_HEX:SIGNATURE (4 segments by ':')
      const parts = result.raw.split(':')
      assert.strictEqual(parts.length, 4)
      // Prefix may contain dashes, so check it contains FPA and PRO
      assert.ok(parts[0].includes('FPA') && parts[0].includes('PRO'))
    })

    test('has the correct prefix', () => {
      assert.strictEqual(generateKey(config).prefix, 'FPA-PRO')
    })

    test('has a valid timestamp', () => {
      const result = generateKey(config)
      assert.ok(result.timestamp > 0)
      assert.ok(result.timestamp <= Date.now())
    })

    test('has a random id', () => {
      const result = generateKey(config)
      assert.ok(typeof result.randomId === 'string')
      assert.strictEqual(result.randomId.length, 16)
    })

    test('has a signature', () => {
      const result = generateKey(config)
      assert.ok(typeof result.signature === 'string')
      assert.strictEqual(result.signature.length, 64)
    })

    test('generates unique keys', () => {
      const key1 = generateKey(config)
      const key2 = generateKey(config)
      assert.notStrictEqual(key1.raw, key2.raw)
      assert.notStrictEqual(key1.signature, key2.signature)
    })

    test('generates all unique keys with entropy', () => {
      const keys = new Set<string>()
      for (let i = 0; i < 100; i++) {
        keys.add(generateKey(config).randomId)
      }
      assert.strictEqual(keys.size, 100)
    })
  })

  describe('verifySignature()', () => {
    test('accepts a valid signed key', () => {
      const keyData = generateKey(config)
      const result = verifySignature(keyData.raw, config)

      assert.strictEqual(result.valid, true)
      assert.ok(result.payload)
      assert.ok(!result.error)
    })

    test('rejects a key with wrong secret', () => {
      const keyData = generateKey(config)
      const result = verifySignature(keyData.raw, { ...config, secret: 'wrong-secret' })

      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Invalid key signature')
    })

    test('rejects a tampered key', () => {
      const keyData = generateKey(config)
      // Tamper with the random portion
      const tampered = keyData.raw.replace(keyData.randomId, 'a'.repeat(16))
      const result = verifySignature(tampered, config)

      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Invalid key signature')
    })

    test('rejects a key with few segments', () => {
      const result = verifySignature('FPA-PRO-invalid', config)
      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Invalid key format: too few segments')
    })

    test('rejects an empty key', () => {
      const result = verifySignature('', config)
      assert.strictEqual(result.valid, false)
    })

    test('rejects an expired key (1+ years old)', () => {
      const oldTimestamp = 1000000000
      const oldTimestampHex = oldTimestamp.toString(16)
      const randomHex = 'a'.repeat(16)
      const payload = `FPA-PRO:${oldTimestampHex}:${randomHex}`
      const signature = createHmac('sha256', config.secret).update(payload).digest('hex')
      const oldKey = `${payload}:${signature}`

      const result = verifySignature(oldKey, config)
      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Key has expired')
    })
  })

  describe('parseKey()', () => {
    test('parses a valid key structure', () => {
      const keyData = generateKey(config)
      const parsed = parseKey(keyData.raw)

      assert.ok(parsed)
      assert.strictEqual(parsed.prefix, 'FPA-PRO')
      assert.strictEqual(parsed.timestamp, keyData.timestamp)
      assert.strictEqual(parsed.randomId, keyData.randomId)
    })

    test('returns null for invalid key', () => {
      assert.strictEqual(parseKey('invalid'), null)
      assert.strictEqual(parseKey(''), null)
      assert.strictEqual(parseKey('only-three-parts'), null)
    })
  })

  describe('batchGenerate()', () => {
    test('generates the specified number of keys', () => {
      assert.strictEqual(batchGenerate(config, 10).length, 10)
    })

    test('generates all valid keys', () => {
      const keys = batchGenerate(config, 50)
      for (const key of keys) {
        const result = verifySignature(key, config)
        assert.strictEqual(result.valid, true)
      }
    })

    test('all keys are unique', () => {
      const keys = batchGenerate(config, 100)
      const unique = new Set(keys)
      assert.strictEqual(unique.size, 100)
    })

    test('generates empty array for count 0', () => {
      assert.strictEqual(batchGenerate(config, 0).length, 0)
    })

    test('generates empty array for negative count', () => {
      assert.strictEqual(batchGenerate(config, -5).length, 0)
    })
  })

  describe('extractKeys()', () => {
    test('extracts keys from space-separated string', () => {
      const valid1 = generateKey(config).raw
      const valid2 = generateKey(config).raw
      const input = `${valid1} ${valid2}`
      const keys = extractKeys(input)
      assert.ok(keys.length >= 2)
      assert.ok(keys.includes(valid1))
      assert.ok(keys.includes(valid2))
    })

    test('filters out short strings', () => {
      const keys = extractKeys('short key1 abc key2')
      assert.strictEqual(keys.length, 0)
    })
  })

  describe('Edge cases', () => {
    test('handles custom prefix with dashes', () => {
      const customConfig = { ...config, prefix: 'CUSTOM-AGENCY' }
      const keyData = generateKey(customConfig)
      assert.strictEqual(keyData.prefix, 'CUSTOM-AGENCY')
      assert.strictEqual(verifySignature(keyData.raw, customConfig).valid, true)
    })

    test('handles custom entropy size', () => {
      const largeEntropyConfig = { ...config, entropyBytes: 32 }
      const keyData = generateKey(largeEntropyConfig)
      assert.strictEqual(keyData.randomId.length, 64)
      assert.strictEqual(verifySignature(keyData.raw, largeEntropyConfig).valid, true)
    })

    test('handles minimum entropy', () => {
      const minEntropyConfig = { ...config, entropyBytes: 1 }
      const keyData = generateKey(minEntropyConfig)
      assert.strictEqual(keyData.randomId.length, 2)
      assert.strictEqual(verifySignature(keyData.raw, minEntropyConfig).valid, true)
    })
  })
})