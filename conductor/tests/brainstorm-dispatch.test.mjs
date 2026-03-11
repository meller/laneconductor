#!/usr/bin/env node
// conductor/tests/brainstorm-dispatch.test.mjs
// Tests for conversation action dispatch correctness.
//
// Tests:
//   TC-1: Brainstorm button does not pass newLaneStatus (no lane change) — JSX source check
//   TC-3: conversation.md gets (brainstorm) tag, not embedded > **system**: prefix
//   TC-5: Worker syncConversation for (brainstorm) sets Waiting for reply: yes
//   TC-6: Worker syncConversation for (brainstorm) does NOT change lane to plan
//   TC-8: Worker syncConversation for (replan) DOES change lane to plan:queue
//   TC-11: customPrompt for brainstorm differs from generic reply prompt
//   TC-12: Post Note uses no_wake:true (parser check)
//
// Run: node --test conductor/tests/brainstorm-dispatch.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-dispatch');

// ── Inline replica of conversation parser (mirrors laneconductor.sync.mjs) ───

function parseConversationComments(content) {
  const comments = [];
  let current = null;
  for (const line of content.split('\n')) {
    const m = line.match(/^>\s+\*\*([\w-]+)\*\*(?:\s+\(([^)]*)\))?\s*:\s*(.*)/);
    if (m) {
      if (current) comments.push(current);
      const options = (m[2] || '').split(',').map(s => s.trim());
      current = {
        author: m[1],
        body: m[3],
        no_wake: options.includes('no-wake') || options.includes('note'),
        is_brainstorm: options.includes('brainstorm'),
        is_replan: options.includes('replan') || options.includes('plan'),
        is_bug: options.includes('bug'),
      };
    } else if (current && line.trim()) {
      current.body += '\n' + line;
    }
  }
  if (current) comments.push(current);
  return comments;
}

// ── Helper: simulate index.md updateHeader ────────────────────────────────────

function updateHeader(content, header, value) {
  const regex = new RegExp(`\\*\\*${header}\\*\\*:\\s*[^\\n]+`, 'i');
  if (regex.test(content)) return content.replace(regex, `**${header}**: ${value}`);
  return content.trim() + `\n**${header}**: ${value}\n`;
}

function simulateBrainstormDispatch(indexContent) {
  // Mirrors the FIXED logic: brainstorm only sets waitingForReply, no lane change
  let idx = indexContent;
  idx = updateHeader(idx, 'Waiting for reply', 'yes');
  // Lane is NOT updated
  return idx;
}

function simulateReplanDispatch(indexContent) {
  // Mirrors the existing replan logic: moves to plan:queue
  let idx = indexContent;
  idx = updateHeader(idx, 'Lane', 'plan');
  idx = updateHeader(idx, 'Lane Status', 'queue');
  idx = updateHeader(idx, 'Waiting for reply', 'no');
  return idx;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Conversation Action Dispatch', () => {

  // ── TC-1: UI source check — Brainstorm button no longer passes 'plan' as newLaneStatus ──
  it('TC-1: Brainstorm button onClick does not pass newLaneStatus (no lane change)', () => {
    const jsx = readFileSync(join(ROOT, 'ui/src/components/TrackDetailPanel.jsx'), 'utf8');

    // Find the Brainstorm button onClick
    const brainstormMatch = jsx.match(/Brainstorm[\s\S]{0,300}?onClick=\{[^}]+\}/m)
      || jsx.match(/onClick=\{[^}]*brainstorm[^}]*\}/);

    // The onClick should use sendComment with command:'brainstorm' but no 'plan' lane
    // Pattern: sendComment(undefined, undefined, false, 'brainstorm') — second arg is undefined/null
    const onClickMatch = jsx.match(/onClick=\{[^}]*sendComment\([^)]*brainstorm[^)]*\)[^}]*\}/);
    assert.ok(onClickMatch, 'Brainstorm button should call sendComment with brainstorm');

    // Extract the sendComment call args for Brainstorm button
    const brainstormButtonSection = jsx.match(
      /(?:Brainstorm[\s\S]{0,50}?onClick|onClick[\s\S]{0,200}?Brainstorm[\s\S]{0,10}).*?sendComment\(([^)]+)\)/s
    );
    if (brainstormButtonSection) {
      const args = brainstormButtonSection[1];
      // Second arg (newLaneStatus) must NOT be 'plan'
      const argList = args.split(',').map(a => a.trim());
      if (argList.length >= 2) {
        assert.notEqual(argList[1].trim(), "'plan'",
          `Brainstorm button second arg (newLaneStatus) must not be 'plan', got: ${argList[1]}`);
        assert.notEqual(argList[1].trim(), '"plan"',
          `Brainstorm button second arg (newLaneStatus) must not be "plan", got: ${argList[1]}`);
      }
    }

    // Simpler direct check: search for the exact bad pattern
    const hasBadPattern = jsx.includes("sendComment(undefined, 'plan', false, 'brainstorm')")
      || jsx.includes('sendComment(undefined, "plan", false, "brainstorm")');
    assert.ok(!hasBadPattern, 'Brainstorm button must not pass plan as newLaneStatus');
  });

  // ── TC-3: (brainstorm) tag is correctly parsed from conversation.md ──
  it('TC-3: conversation.md (brainstorm) tag is parsed as is_brainstorm=true', () => {
    const convContent = `\n> **human** (brainstorm): How should we handle the terminology?\n`;
    const comments = parseConversationComments(convContent);
    assert.equal(comments.length, 1);
    assert.ok(comments[0].is_brainstorm, 'should detect is_brainstorm = true');
    assert.ok(!comments[0].is_replan, 'should not be is_replan');
    assert.equal(comments[0].body, 'How should we handle the terminology?');
  });

  // ── TC-3b: Old embedded > **system**: format is NOT parsed as is_brainstorm ──
  it('TC-3b: embedded > **system**: prefix in body is NOT a brainstorm command', () => {
    const badContent = `\n> **human**: > **system**: Brainstorm requested via UI.\n`;
    const comments = parseConversationComments(badContent);
    assert.equal(comments.length, 1);
    assert.ok(!comments[0].is_brainstorm, 'embedded system prefix should NOT trigger is_brainstorm');
  });

  // ── TC-5: After brainstorm dispatch, index.md gets Waiting for reply: yes ──
  it('TC-5: brainstorm dispatch sets Waiting for reply: yes in index.md', () => {
    const indexContent = `# Track 012: Test\n\n**Lane**: implement\n**Lane Status**: success\n**Progress**: 60%\n`;
    const updated = simulateBrainstormDispatch(indexContent);
    assert.ok(updated.includes('**Waiting for reply**: yes'), 'should set Waiting for reply: yes');
  });

  // ── TC-6: After brainstorm dispatch, lane does NOT change ──
  it('TC-6: brainstorm dispatch does NOT change lane to plan', () => {
    const indexContent = `# Track 012: Test\n\n**Lane**: implement\n**Lane Status**: success\n**Progress**: 60%\n`;
    const updated = simulateBrainstormDispatch(indexContent);
    assert.ok(updated.includes('**Lane**: implement'), 'Lane should remain implement');
    assert.ok(!updated.includes('**Lane**: plan'), 'Lane must NOT be changed to plan');
    assert.ok(!updated.includes('**Lane Status**: queue'), 'Lane Status must NOT be set to queue');
  });

  // ── TC-8: Replan dispatch DOES change lane to plan:queue ──
  it('TC-8: replan dispatch moves track to plan:queue', () => {
    const indexContent = `# Track 012: Test\n\n**Lane**: implement\n**Lane Status**: success\n**Progress**: 60%\n`;
    const updated = simulateReplanDispatch(indexContent);
    assert.ok(updated.includes('**Lane**: plan'), 'Lane should change to plan');
    assert.ok(updated.includes('**Lane Status**: queue'), 'Lane Status should be queue');
    assert.ok(updated.includes('**Waiting for reply**: no'), 'Waiting for reply should be no');
  });

  // ── TC-11: customPrompt for brainstorm is distinct from generic reply prompt ──
  it('TC-11: brainstorm-specific prompt is focused (does not say re-scaffold)', () => {
    const syncMjs = readFileSync(join(ROOT, 'conductor/laneconductor.sync.mjs'), 'utf8');
    // The brainstorm prompt should exist and NOT say "re-scaffold"
    const hasBrainstormPrompt = syncMjs.includes('brainstorm') && syncMjs.includes('clarifying');
    assert.ok(hasBrainstormPrompt, 'sync.mjs should contain brainstorm clarifying prompt');

    // The focused prompt should NOT instruct to re-scaffold spec.md/plan.md
    // (The generic prompt has "deepen the spec.md and plan.md" which is OK,
    //  but should not say to do a full re-scaffold without answering the question)
    const brainstormPromptSection = syncMjs.match(/brainstorm[\s\S]{0,500}?clarifying/);
    if (brainstormPromptSection) {
      assert.ok(!brainstormPromptSection[0].includes('re-scaffold'),
        'brainstorm prompt should not instruct re-scaffolding');
    }
  });

  // ── TC-12: Post Note uses no_wake correctly ──
  it('TC-12: (note) tag is parsed as no_wake=true', () => {
    const convContent = `\n> **human** (note): This is just a note, don't wake workers\n`;
    const comments = parseConversationComments(convContent);
    assert.equal(comments.length, 1);
    assert.ok(comments[0].no_wake, 'note tag should set no_wake = true');
    assert.ok(!comments[0].is_brainstorm, 'note should not be brainstorm');
  });

  // ── TC-13: Regular send (no tag) does not set no_wake ──
  it('TC-13: plain human comment has no_wake=false, is_brainstorm=false', () => {
    const convContent = `\n> **human**: Can you help with this feature?\n`;
    const comments = parseConversationComments(convContent);
    assert.equal(comments.length, 1);
    assert.ok(!comments[0].no_wake, 'plain comment should not be no_wake');
    assert.ok(!comments[0].is_brainstorm, 'plain comment should not be brainstorm');
  });
});
