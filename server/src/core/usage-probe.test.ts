import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClaudeUsage, normalizeCodexRateLimits, normalizeAgyQuota, isMeteredExec } from './usage-probe.js';

// Shape captured from a live GET /api/oauth/usage response (values trimmed).
const CLAUDE_LIVE_SHAPE = {
  five_hour: { utilization: 8.0, resets_at: '2026-08-06T05:40:00.494068+00:00' },
  seven_day: null,
  limits: [
    { kind: 'session', group: 'session', percent: 8, severity: 'normal', resets_at: '2026-08-06T05:40:00.494068+00:00', scope: null, is_active: true }
  ]
};

test('claude: prefers limits[] and maps session → 5h with reset', () => {
  const w = normalizeClaudeUsage(CLAUDE_LIVE_SHAPE);
  assert.deepEqual(w, [{ label: '5h', usedPct: 8, resetsAt: '2026-08-06T05:40:00.494068+00:00' }]);
});

test('claude: maps weekly kinds and skips inactive limits', () => {
  const w = normalizeClaudeUsage({
    limits: [
      { kind: 'session', percent: 12.34, resets_at: 'A', is_active: true },
      { kind: 'weekly', percent: 55, resets_at: 'B', is_active: true },
      { kind: 'seven_day_opus', percent: 90, resets_at: 'C', is_active: false }
    ]
  });
  assert.deepEqual(w.map(x => x.label), ['5h', '7d']);
  assert.equal(w[0].usedPct, 12.3);
});

test('claude: falls back to five_hour/seven_day objects when limits[] is absent', () => {
  const w = normalizeClaudeUsage({
    five_hour: { utilization: 40, resets_at: 'X' },
    seven_day: { utilization: 71.5, resets_at: 'Y' }
  });
  assert.deepEqual(w, [
    { label: '5h', usedPct: 40, resetsAt: 'X' },
    { label: '7d', usedPct: 71.5, resetsAt: 'Y' }
  ]);
});

test('claude: clamps out-of-range percents and returns [] on garbage', () => {
  assert.deepEqual(normalizeClaudeUsage({ limits: [{ kind: 'session', percent: 250, is_active: true }] })[0].usedPct, 100);
  assert.deepEqual(normalizeClaudeUsage(null), []);
  assert.deepEqual(normalizeClaudeUsage({ limits: [{ kind: 'session', percent: 'nope' }] }), []);
});

test('codex: maps primary/secondary windows with absolute reset times', () => {
  const at = Date.parse('2026-08-06T00:00:00Z');
  const w = normalizeCodexRateLimits({
    primary: { used_percent: 62.5, window_minutes: 300, resets_in_seconds: 3600 },
    secondary: { used_percent: 21, window_minutes: 10080, resets_in_seconds: 86400 }
  }, at);
  assert.deepEqual(w, [
    { label: '5h', usedPct: 62.5, resetsAt: '2026-08-06T01:00:00.000Z' },
    { label: '7d', usedPct: 21, resetsAt: '2026-08-07T00:00:00.000Z' }
  ]);
});

test('codex: unusual window sizes get derived labels; missing fields are skipped', () => {
  const w = normalizeCodexRateLimits({
    primary: { used_percent: 10, window_minutes: 60 },
    secondary: { window_minutes: 10080 }   // no used_percent → skipped
  }, 0);
  assert.deepEqual(w, [{ label: '1h', usedPct: 10, resetsAt: undefined }]);
});

test('agy: inverts remaining→used and derives window labels from grouped buckets', () => {
  // Shape mirrors retrieveUserQuotaSummary: buckets nested under a group,
  // each carrying a REMAINING percent (the CLI renders "%.0f%% remaining").
  const w = normalizeAgyQuota({
    quotaSummaryGroups: [{
      quotaSummaryBuckets: [
        { remaining: 82, windowMinutes: 300, resetTime: '2026-08-06T05:00:00Z' },
        { remaining: 40.5, windowMinutes: 10080, resetTime: '2026-08-13T00:00:00Z' }
      ]
    }]
  });
  assert.deepEqual(w, [
    { label: '5h', usedPct: 18, resetsAt: '2026-08-06T05:00:00Z' },
    { label: '7d', usedPct: 59.5, resetsAt: '2026-08-13T00:00:00Z' }
  ]);
});

test('agy: accepts flat buckets, alias fields, and slug labels; clamps + skips garbage', () => {
  const w = normalizeAgyQuota({
    buckets: [
      { percentRemaining: 100, displayName: 'Gemini 3 Pro Requests' }, // used 0, name slug
      { remaining: -5 },                                               // used clamps to 100
      { displayName: 'no-remaining-field' }                            // skipped
    ]
  });
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], { label: 'Gemini 3 Pro', usedPct: 0, resetsAt: undefined });
  assert.equal(w[1].usedPct, 100);
  assert.deepEqual(normalizeAgyQuota(null), []);
});

test('metered execs: claude/codex/agy yes; hermes/ollama/script no', () => {
  assert.equal(isMeteredExec('claude'), true);
  assert.equal(isMeteredExec('codex'), true);
  assert.equal(isMeteredExec('agy'), true);
  for (const e of ['hermes', 'ollama', 'script', undefined]) assert.equal(isMeteredExec(e), false);
});
