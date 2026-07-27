import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyOutput, parseLlmVerdict, buildVerifierPrompt, DEFAULT_FAIL_PATTERNS } from './result-verifier.js';

/**
 * The result verifier is the fix for "a rate-limit reply looked like a done
 * task": a brain that exits 0 but returned a soft failure must be REJECTED so the
 * dispatcher hands the task to the next fallback brain. These tests pin the
 * deterministic verdict and the LLM-reply parser.
 */

test('a genuine long deliverable passes', () => {
  const v = verifyOutput('# Report\n\nHere is a thorough answer to the task, complete with sections and detail.', true);
  assert.equal(v.ok, true);
});

test('rate-limit reply that exited 0 is rejected', () => {
  const v = verifyOutput('I\'m sorry, the rate limit reached for this model. Please try again later.', true);
  assert.equal(v.ok, false);
  assert.match(v.reason || '', /failure pattern/i);
});

test('claude-style usage limit notice is rejected', () => {
  const v = verifyOutput("You've reached your usage limit. Upgrade to continue.", true);
  assert.equal(v.ok, false);
});

test('HTTP 429 body is rejected', () => {
  assert.equal(verifyOutput('Error 429 Too Many Requests', true).ok, false);
});

test('overloaded / capacity notice is rejected', () => {
  assert.equal(verifyOutput('{"type":"overloaded_error","message":"the model is overloaded"}', true).ok, false);
});

test('quota / credits exhaustion is rejected', () => {
  assert.equal(verifyOutput('Your credit balance is too low to run this request.', true).ok, false);
  assert.equal(verifyOutput('quota exceeded for this key', true).ok, false);
});

test('empty output is rejected even when the process exited 0', () => {
  const v = verifyOutput('   \n  ', true);
  assert.equal(v.ok, false);
  assert.match(v.reason || '', /empty/i);
});

test('minLength gate rejects a too-short answer', () => {
  assert.equal(verifyOutput('ok', true, { minLength: 50 }).ok, false);
});

test('a non-zero exit is a failure regardless of text', () => {
  const v = verifyOutput('partial work here', false);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'partial work here');
});

test('does NOT flag a legitimate article that merely discusses rate limiting', () => {
  const article = 'When designing an API you should implement throttling. '.repeat(40) +
    'Consider how clients handle a 429 response and back off gracefully. ' +
    'This section explains rate limiting concepts in depth for engineers.';
  // Phrase-level patterns ("rate limit reached", not bare "rate limit") avoid this false positive.
  assert.equal(verifyOutput(article, true).ok, true);
});

test('custom failPatterns merge with the built-ins', () => {
  assert.equal(verifyOutput('SPECIAL_SENTINEL_ERROR occurred', true, { failPatterns: ['special_sentinel_error'] }).ok, false);
  // built-ins still apply when merging
  assert.equal(verifyOutput('rate limit reached', true, { failPatterns: ['x'] }).ok, false);
});

test('replacePatterns swaps out the built-ins entirely', () => {
  // With replace, the built-in "rate limit reached" no longer trips it.
  assert.equal(verifyOutput('rate limit reached', true, { failPatterns: ['only-this'], replacePatterns: true }).ok, true);
  assert.equal(verifyOutput('only-this', true, { failPatterns: ['only-this'], replacePatterns: true }).ok, false);
});

test('DEFAULT_FAIL_PATTERNS is non-empty and lowercase-safe', () => {
  assert.ok(DEFAULT_FAIL_PATTERNS.length > 0);
  // matching is case-insensitive
  assert.equal(verifyOutput('RATE LIMIT REACHED', true).ok, false);
});

test('parseLlmVerdict: explicit FAIL rejects', () => {
  const v = parseLlmVerdict('FAIL\nThe result is just a rate-limit apology, not the deliverable.');
  assert.equal(v.ok, false);
  assert.match(v.reason || '', /verifier LLM/);
});

test('parseLlmVerdict: PASS accepts', () => {
  assert.equal(parseLlmVerdict('PASS\nlooks complete').ok, true);
});

test('parseLlmVerdict: fails open on a blank/garbled verifier reply', () => {
  assert.equal(parseLlmVerdict('').ok, true);
  assert.equal(parseLlmVerdict('   \n ').ok, true);
});

test('parseLlmVerdict: earliest of PASS/FAIL wins', () => {
  // "PASS" appears before "FAIL" -> pass; guards against a trailing "do not FAIL" note.
  assert.equal(parseLlmVerdict('PASS — this is fine, do not FAIL it').ok, true);
  assert.equal(parseLlmVerdict('FAIL — this is not a PASS').ok, false);
});

test('buildVerifierPrompt includes task + result and asks for PASS/FAIL', () => {
  const p = buildVerifierPrompt({ title: 'Write X', description: 'details' }, 'the deliverable');
  assert.match(p, /Write X/);
  assert.match(p, /the deliverable/);
  assert.match(p, /PASS or FAIL/);
});
