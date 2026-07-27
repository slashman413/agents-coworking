/**
 * Result verification — catches the case a raw exit-code check misses: a brain's
 * CLI exits 0 (so the spawn *looks* successful) but the "result" is really a soft
 * failure — a rate-limit / quota notice, an overloaded / try-again message, an
 * auth error, or an empty answer. Left unchecked these masquerade as completed
 * tasks with no errors. The dispatcher runs this verdict on every finished attempt
 * and, on a bad one, hands the task to the NEXT brain in the fallback chain
 * (recording which brain failed on the task — see Dispatcher.execute).
 *
 * Two independent gates:
 *   1. this module — cheap, deterministic pattern/emptiness check (always on).
 *   2. an optional LLM "verifier agent" the dispatcher runs on top (config-gated)
 *      that judges whether the output actually satisfies the task.
 */

export interface VerifyVerdict {
  ok: boolean;
  /** Set when ok === false: why the result was rejected (logged + stored on the task). */
  reason?: string;
}

export interface VerifyOptions {
  /** Extra case-insensitive substrings that mark a bad result. */
  failPatterns?: string[];
  /** Replace the built-in patterns entirely instead of merging the extras in. */
  replacePatterns?: boolean;
  /** A result whose trimmed length is below this is treated as empty / non-deliverable. */
  minLength?: number;
}

/**
 * High-signal phrases a model or CLI emits when it *couldn't* do the work but
 * still exited cleanly. Deliberately phrase-level (not the bare token "rate
 * limit") so a legitimate long deliverable that merely discusses rate limiting
 * or 429 handling isn't flagged. Matched case-insensitively as substrings.
 */
export const DEFAULT_FAIL_PATTERNS: string[] = [
  // rate limits / usage caps
  'rate limit reached',
  'rate limit exceeded',
  'rate-limited',
  'hit the rate limit',
  'hit your rate limit',
  "you've hit your",
  'you have hit your',
  "you've reached your",
  'you have reached your',
  'usage limit reached',
  'reached your usage limit',
  'reached your daily limit',
  'reached your monthly limit',
  'too many requests',
  // quota / credits / billing
  'quota exceeded',
  'exceeded your quota',
  'insufficient quota',
  'insufficient_quota',
  'out of credits',
  'credit balance is too low',
  'please upgrade your plan',
  'upgrade to continue',
  // capacity / availability
  'resource exhausted',
  'resource_exhausted',
  'model is overloaded',
  'currently overloaded',
  'overloaded_error',
  // HTTP status shapes
  'error 429',
  '429 too many requests',
  'http 429',
  'status code 429',
  'status: 429',
  // auth (exit-0 CLIs sometimes print these to stdout)
  'authentication_error',
  'invalid api key',
  'invalid x-api-key',
  'your credit balance',
];

/**
 * Deterministic verdict on one attempt's output. `spawnOk` is the raw exit-code
 * result (false = the process itself failed/timed out — already a failure).
 * Returns ok:false with a short reason when the output is empty or matches a
 * known soft-failure phrase.
 */
export function verifyOutput(text: string, spawnOk: boolean, opts: VerifyOptions = {}): VerifyVerdict {
  if (!spawnOk) return { ok: false, reason: firstLine(text) || 'process exited non-zero' };

  const clean = (text || '').trim();
  const minLength = opts.minLength ?? 1;
  if (clean.length < minLength) {
    return { ok: false, reason: `empty result (${clean.length} < ${minLength} chars)` };
  }

  const patterns = opts.replacePatterns
    ? (opts.failPatterns ?? [])
    : [...DEFAULT_FAIL_PATTERNS, ...(opts.failPatterns ?? [])];
  const hay = clean.toLowerCase();
  for (const p of patterns) {
    const needle = p.toLowerCase();
    if (needle && hay.includes(needle)) {
      return { ok: false, reason: `matched failure pattern "${p}"` };
    }
  }
  return { ok: true };
}

/** First non-empty line, trimmed and capped — a compact reason for logs/context. */
function firstLine(text: string): string {
  const line = (text || '').split('\n').map(l => l.trim()).find(Boolean) || '';
  return line.slice(0, 200);
}

/**
 * Build the prompt for the optional LLM "verifier agent". It reads the task and
 * the produced result and answers PASS / FAIL — a quality gate stacked on top of
 * the deterministic check for cases a pattern can't catch (e.g. a fluent but
 * off-topic or refusal answer). Parse the reply with {@link parseLlmVerdict}.
 */
export function buildVerifierPrompt(task: { title: string; description: string }, result: string): string {
  return [
    `You are a strict RESULT VERIFIER in a multi-agent company. Judge ONLY whether the RESULT below is a genuine, on-topic completion of the TASK.`,
    `FAIL it if the result is a rate-limit / quota / overloaded notice, an error or refusal, empty, truncated mid-thought, or does not actually address the task.`,
    `PASS it if it is a real, on-topic deliverable (even if imperfect).`,
    ``,
    `TASK: ${task.title}`,
    (task.description || '').slice(0, 2000),
    ``,
    `RESULT:`,
    (result || '').slice(0, 6000),
    ``,
    `Answer with exactly one word on the first line: PASS or FAIL. On a second line, give a short reason.`,
  ].join('\n');
}

/**
 * Turn a verifier LLM reply into a verdict. Conservative: only an explicit,
 * unambiguous FAIL rejects the result — a blank/garbled reply from the verifier
 * brain must not discard a real deliverable (fail-open), so anything that isn't a
 * clear FAIL passes.
 */
export function parseLlmVerdict(reply: string): VerifyVerdict {
  const text = (reply || '').trim();
  if (!text) return { ok: true };
  const upper = text.toUpperCase();
  const firstPass = upper.indexOf('PASS');
  const firstFail = upper.indexOf('FAIL');
  const isFail = firstFail !== -1 && (firstPass === -1 || firstFail < firstPass);
  if (isFail) return { ok: false, reason: `verifier LLM: ${firstLine(text)}` };
  return { ok: true };
}
