// Database migration for Increment 5 (Hardening):
// Adds the license_keys table and download_rate_limits table
// to the Founder's FP&A modular monolith.
//
// This migration is compatible with the schema defined in the
// Technical Architecture & Build Plan (architecture-digital-products.md).
// The licenses table was already defined there; this migration adds
// the companion tables needed for rate limiting and enhanced tracking.

-- Migration: 0001_increment5_hardening
-- Date: 2026-07-30
-- Description: Add rate limiting and license key tracking tables

-- license_keys table: extends the `licenses` table from architecture doc
-- with activation tracking, expiry, and customer association.
CREATE TABLE IF NOT EXISTS license_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT UNIQUE NOT NULL,            -- the actual license key (HMAC-signed)
  product_id      UUID NOT NULL REFERENCES products(id),
  entitlement_id  UUID NOT NULL REFERENCES entitlements(id),
  customer_email  CITEXT NOT NULL,                  -- who owns this license
  tier            TEXT NOT NULL DEFAULT 'pro',       -- free|pro|agency
  status          TEXT NOT NULL DEFAULT 'active',   -- active|used|revoked|expired
  activation_cap  INTEGER,                          -- null = unlimited activations
  activations     INTEGER NOT NULL DEFAULT 0,
  activated_at    TIMESTAMPTZ,                      -- when first activated
  expires_at      TIMESTAMPTZ,                      -- null = perpetual (one-time buys)
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_license_keys_product ON license_keys(product_id) WHERE status = 'active';
CREATE INDEX idx_license_keys_customer ON license_keys(customer_email) WHERE status = 'active';
CREATE INDEX idx_license_keys_key ON license_keys(key) WHERE status = 'active';

-- download_rate_limits: tracks per-entitlement download rate limit state.
-- This mirrors the in-memory rate limiter but persists the state so that:
--  - Serverless cold starts don't reset limits
--  - Multi-region deployments can share state
--  - We can audit and debug rate limit decisions
CREATE TABLE IF NOT EXISTS download_rate_limits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id    UUID NOT NULL REFERENCES entitlements(id),
  asset_version_id  UUID NOT NULL REFERENCES assets(id),
  window_start      TIMESTAMPTZ NOT NULL,
  request_count     INTEGER NOT NULL DEFAULT 0,
  window_seconds    INTEGER NOT NULL DEFAULT 3600,  -- default 1 hour window
  UNIQUE (entitlement_id, asset_version_id, window_start)
);

CREATE INDEX idx_download_rate_lookup
  ON download_rate_limits(entitlement_id, asset_version_id)
  WHERE window_start > now() - interval '24 hours';

-- license_key_audit_log: track every license verification attempt.
-- Critical for fraud detection and post-incident analysis.
CREATE TABLE IF NOT EXISTS license_key_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_fingerprint TEXT NOT NULL,                    -- first 16 chars of the key (no full key stored)
  customer_email  CITEXT,
  action          TEXT NOT NULL,                    -- verify|activate|revoke|check
  result          TEXT NOT NULL,                    -- success|failed|rate_limited
  ip_hash         TEXT,
  user_agent_hash TEXT,
  metadata        JSONB,                            -- extra context (error reason, attempt count, etc.)
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_license_audit_email ON license_key_audit_log(customer_email, at);
CREATE INDEX idx_license_audit_action ON license_key_audit_log(action, at);

-- add updated_at trigger if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_license_keys_updated_at
  BEFORE UPDATE ON license_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();