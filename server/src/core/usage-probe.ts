import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BrainUsage, BrainUsageWindow, BrainConfig } from '../types.js';
import type { Store } from './store.js';

/**
 * Rate-limit usage prober for METERED brain execs, feeding the Connections
 * cards ("how much of this brain's quota is burned, and when does it reset").
 *
 * Strategy per exec — everything is best-effort and fails to `null` (no data →
 * the UI simply doesn't render a meter):
 *
 *   claude — Claude Code's own OAuth credential (~/.claude/.credentials.json)
 *            against the official usage endpoint. Returns per-window percent +
 *            resets_at (5h session, 7d caps when the plan has them).
 *   codex  — Codex CLI writes a `rate_limits` snapshot into every session
 *            rollout jsonl; read the newest one. No network call.
 *   agy    — Antigravity (Google's agentic CLI) has NO local quota snapshot
 *            file. Its quota lives behind the authenticated Code Assist RPC
 *            `cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`
 *            (the CLI's own UI renders it as "%.0f%% remaining"). We probe it
 *            when a ready-to-use bearer access token is supplied (env
 *            AGY_ACCESS_TOKEN, or a token file exposing `access_token`) —
 *            Antigravity itself keeps only a refresh token on disk (a
 *            `user_refresh.antigravity` file under ~/.gemini) and mints access
 *            tokens in-process, so we deliberately do NOT re-implement its OAuth
 *            exchange or embed its client secret. NOTE: unlike claude/codex the
 *            quota is reported as REMAINING, so we invert to used = 100 - remaining.
 *   hermes / ollama / script — self-hosted, no external rate limit BY DESIGN;
 *            deliberately absent so those brains never show a meter.
 *
 * The same claude/codex/agy logic exists in plain-JS form in
 * deploy/remote-brain-client.mjs (zero-dep client, can't import this file);
 * keep the two in sync when changing normalization.
 */

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const AGY_QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary';

/** Clamp + round a percent into 0–100 with one decimal. */
function pct(n: unknown): number | null {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
}

/**
 * Normalize the Anthropic OAuth usage payload into windows. Prefers the
 * structured `limits[]` array ({kind, percent, resets_at}); falls back to the
 * legacy five_hour/seven_day objects ({utilization, resets_at}). Exported for
 * tests.
 */
export function normalizeClaudeUsage(raw: any): BrainUsageWindow[] {
  const windows: BrainUsageWindow[] = [];
  const label = (kind: string) =>
    kind === 'session' || kind === 'five_hour' ? '5h'
      : kind === 'weekly' || kind === 'seven_day' ? '7d'
      : kind.replace(/^seven_day_/, '7d-');
  if (Array.isArray(raw?.limits)) {
    for (const l of raw.limits) {
      const p = pct(l?.percent);
      if (p == null || l?.is_active === false) continue;
      windows.push({ label: label(String(l.kind || l.group || '?')), usedPct: p, resetsAt: l.resets_at || undefined });
    }
  }
  if (!windows.length) {
    for (const key of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']) {
      const w = raw?.[key];
      const p = pct(w?.utilization);
      if (p == null) continue;
      windows.push({ label: label(key), usedPct: p, resetsAt: w.resets_at || undefined });
    }
  }
  return windows;
}

/** Read Claude Code's OAuth token from the standard credentials file. */
function claudeToken(): string | null {
  try {
    const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'));
    return cred?.claudeAiOauth?.accessToken || null;
  } catch { return null; }
}

async function probeClaude(): Promise<BrainUsageWindow[] | null> {
  const token = claudeToken();
  if (!token) return null;
  try {
    const res = await fetch(CLAUDE_USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const windows = normalizeClaudeUsage(await res.json());
    return windows.length ? windows : null;
  } catch { return null; }
}

/**
 * Normalize one Codex `rate_limits` snapshot ({primary, secondary} with
 * used_percent / window_minutes / resets_in_seconds) into windows. `atMs` is
 * when the snapshot was recorded (resets_in_seconds is relative to it).
 * Exported for tests.
 */
export function normalizeCodexRateLimits(rl: any, atMs: number): BrainUsageWindow[] {
  const windows: BrainUsageWindow[] = [];
  for (const key of ['primary', 'secondary']) {
    const w = rl?.[key];
    const p = pct(w?.used_percent);
    if (p == null) continue;
    const mins = Number(w.window_minutes);
    const label = mins === 10080 ? '7d' : mins === 300 ? '5h'
      : Number.isFinite(mins) && mins > 0 ? (mins >= 1440 ? `${Math.round(mins / 1440)}d` : `${Math.round(mins / 60)}h`)
      : key;
    const resetSec = Number(w.resets_in_seconds);
    windows.push({
      label, usedPct: p,
      resetsAt: Number.isFinite(resetSec) ? new Date(atMs + resetSec * 1000).toISOString() : undefined
    });
  }
  return windows;
}

/** Newest-first list of Codex session rollout files (sessions/YYYY/MM/DD/*.jsonl). */
function codexSessionFiles(root = path.join(os.homedir(), '.codex', 'sessions')): string[] {
  const out: { file: string; mtime: number }[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try { out.push({ file: p, mtime: fs.statSync(p).mtimeMs }); } catch { /* raced away */ }
      }
    }
  };
  walk(root, 0);
  return out.sort((a, b) => b.mtime - a.mtime).map(o => o.file);
}

/** Last rate_limits snapshot from the newest Codex session logs (checks a few
 *  recent files in case the newest session hasn't emitted a token_count yet). */
function probeCodex(): BrainUsageWindow[] | null {
  for (const file of codexSessionFiles().slice(0, 5)) {
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"rate_limits"')) continue;
        const ev = JSON.parse(lines[i]);
        const rl = ev?.payload?.rate_limits || ev?.rate_limits;
        if (!rl) continue;
        const atMs = ev.timestamp ? new Date(ev.timestamp).getTime() : fs.statSync(file).mtimeMs;
        const windows = normalizeCodexRateLimits(rl, atMs);
        if (windows.length) return windows;
      }
    } catch { /* unreadable file → try the next one */ }
  }
  return null;
}

/** First finite number among the candidates, else null. */
function firstNum(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Short label for an Antigravity quota bucket — prefer a window duration,
 *  else a compact slug of the bucket's display name / id, else 'quota'. */
function agyLabel(bucket: any, group: any): string {
  const mins = firstNum(bucket?.windowMinutes, group?.windowMinutes);
  const secs = firstNum(bucket?.windowSeconds, bucket?.windowDurationSeconds, group?.windowSeconds);
  const m = mins ?? (secs != null ? secs / 60 : null);
  if (m != null && m > 0) {
    if (m === 10080) return '7d';
    if (m === 300) return '5h';
    return m >= 1440 ? `${Math.round(m / 1440)}d` : `${Math.round(m / 60)}h`;
  }
  const name = String(bucket?.displayName || bucket?.quotaId || bucket?.name
    || group?.displayName || group?.quotaId || '').trim();
  return name ? name.slice(0, 12) : 'quota';
}

/**
 * Normalize an Antigravity `retrieveUserQuotaSummary` response into windows.
 * Antigravity's schema nests `QuotaSummaryBucket`s (each carrying a *remaining*
 * percent) under one or more `QuotaSummaryGroup`s; we also accept a flat
 * `buckets[]`. Unlike claude/codex the value is REMAINING, so we invert to
 * usedPct = 100 - remaining. Best-effort and tolerant of field-name variants.
 * Exported for tests.
 */
export function normalizeAgyQuota(raw: any): BrainUsageWindow[] {
  const asArray = (v: any, single: any) =>
    Array.isArray(v) ? v : (single != null ? [single] : []);
  const groups = asArray(
    raw?.quotaSummaryGroups || raw?.groups,
    raw?.quotaSummaryGroup
  );
  const pairs: { b: any; g: any }[] = [];
  for (const g of groups) {
    for (const b of asArray(g?.quotaSummaryBuckets || g?.buckets, g?.quotaSummaryBucket)) {
      pairs.push({ b, g });
    }
  }
  for (const b of asArray(raw?.quotaSummaryBuckets || raw?.buckets, null)) {
    pairs.push({ b, g: raw });
  }
  const windows: BrainUsageWindow[] = [];
  for (const { b, g } of pairs) {
    const remaining = firstNum(
      b?.remaining, b?.remainingPercent, b?.percentRemaining,
      b?.bucketInfo?.remaining, b?.quotaInfo?.remaining
    );
    if (remaining == null) continue;
    const used = pct(100 - remaining);
    if (used == null) continue;
    windows.push({
      label: agyLabel(b, g),
      usedPct: used,
      resetsAt: b?.resetTime || b?.resetsAt || b?.bucketInfo?.resetTime || g?.resetTime || undefined
    });
  }
  return windows;
}

/** A ready-to-use Antigravity bearer access token, if one is supplied. We
 *  never re-implement Antigravity's OAuth refresh (it holds the client secret
 *  in-process): accept a token from AGY_ACCESS_TOKEN, or a JSON token file
 *  named by AGY_TOKEN_FILE that already exposes an `access_token`. */
function agyAccessToken(): string | null {
  const env = process.env.AGY_ACCESS_TOKEN?.trim();
  if (env) return env;
  const file = process.env.AGY_TOKEN_FILE?.trim();
  if (file) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const tok = JSON.parse(raw)?.access_token || JSON.parse(raw)?.token;
      if (typeof tok === 'string' && tok) return tok;
    } catch { /* unreadable / not JSON / refresh-only → no meter */ }
  }
  return null;
}

async function probeAgy(): Promise<BrainUsageWindow[] | null> {
  const token = agyAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(AGY_QUOTA_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const windows = normalizeAgyQuota(await res.json());
    return windows.length ? windows : null;
  } catch { return null; }
}

/** Execs we know how to meter on THIS host. */
const PROBES: Record<string, () => Promise<BrainUsageWindow[] | null> | BrainUsageWindow[] | null> = {
  claude: probeClaude,
  codex: probeCodex,
  agy: probeAgy
};

export function isMeteredExec(exec?: string): boolean { return !!exec && exec in PROBES; }

/**
 * Background poller: measures usage once per metered exec (all local claude
 * brains share one account → one HTTP call) and stamps the result onto every
 * LOCAL brain with that exec. Remote brains are NOT touched here — their own
 * client self-reports via heartbeat.
 */
export class UsagePoller {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private store: Store,
    private brains: () => Record<string, BrainConfig>,
    private intervalMs = 300000
  ) {}

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async refresh(): Promise<void> {
    const byExec = new Map<string, string[]>();
    for (const [id, b] of Object.entries(this.brains())) {
      if (b.location !== 'local' || !isMeteredExec(b.exec)) continue;
      const ids = byExec.get(b.exec!) || [];
      ids.push(id);
      byExec.set(b.exec!, ids);
    }
    for (const [exec, ids] of byExec) {
      let windows: BrainUsageWindow[] | null = null;
      try { windows = await PROBES[exec](); } catch { /* fail-soft: keep last snapshot */ }
      if (!windows) continue;
      const usage: BrainUsage = { exec, windows, at: new Date().toISOString() };
      for (const id of ids) this.store.setBrainUsage(id, usage);
    }
  }
}
