// ui/src/components/wizard/FollowBuildView.test.jsx
// Track AM-1119 Phase 5 (TC-12/TC-13/TC-14): post-launch "follow your
// build" handoff — live per-track lane badges, Needs-your-input
// classification reusing GET /api/inbox's own rule, and the app_url
// placeholder→live-link transition.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FollowBuildView, needsInput } from './FollowBuildView.jsx';

const apiFetchMock = vi.fn();

// Passed through directly (not wrapped in a new arrow function per call) so
// the mocked `apiFetch` is referentially stable across re-renders, matching
// what the real useApi() guarantees via useCallback. FollowBuildView's
// polling effects list `apiFetch` in their dependency array (same
// convention as NewProjectModal's own poll effect) — an unstable mock
// reference here would retrigger the effect on every render, which
// (confirmed live) spins the component into an infinite render loop that
// never lets any poll-based assertion settle.
vi.mock('../../hooks/useApi.js', () => ({
  useApi: () => ({ apiFetch: apiFetchMock }),
}));

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

describe('needsInput (pure classification, mirrors GET /api/inbox)', () => {
  it('is true when waiting_for_reply is set', () => {
    expect(needsInput({ waiting_for_reply: true })).toBe(true);
  });

  it('is true when the latest system comment starts with ⚠️ or ❌', () => {
    expect(needsInput({ last_comment_author: 'system', last_comment_body: '⚠️ FUNDAMENTALS CONFLICT' })).toBe(true);
    expect(needsInput({ last_comment_author: 'system', last_comment_body: '❌ QUALITY GATE FAILED' })).toBe(true);
  });

  it('is false for a system ✅ comment or a non-system author', () => {
    expect(needsInput({ last_comment_author: 'system', last_comment_body: '✅ Plan complete' })).toBe(false);
    expect(needsInput({ last_comment_author: 'human', last_comment_body: '⚠️ looks wrong' })).toBe(false);
  });
});

describe('FollowBuildView', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('resolves projectId from repoPath by polling GET /api/projects, then shows tracks', async () => {
    apiFetchMock.mockImplementation(async (url) => {
      if (url === '/api/projects') {
        return jsonResponse([{ id: 42, repo_path: '/home/you/Code/digger-game', app_url: null }]);
      }
      if (url === '/api/projects/42/tracks') {
        return jsonResponse([
          { track_number: '1000', title: 'App Skeleton', lane_status: 'implement', waiting_for_reply: false },
        ]);
      }
      // Not a real production call — Vitest's own test-runner cleanup-hook
      // machinery invokes the mock with no arguments during unmount/teardown
      // (confirmed via stack trace: @vitest/runner's callCleanupHooks, not
      // React or this component). Fall back harmlessly instead of throwing.
      return jsonResponse([]);
    });

    render(<FollowBuildView repoPath="/home/you/Code/digger-game" onClose={() => {}} pollIntervalMs={20} />);

    expect(screen.getByTestId('follow-build-waiting')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('follow-build-track-1000')).toBeInTheDocument());
    expect(screen.getByTestId('follow-build-track-1000')).toHaveTextContent('App Skeleton');
    expect(screen.getByTestId('follow-build-lane-1000')).toHaveTextContent('Build'); // implement → "Build" label
  });

  it('TC-12: a lane change on a later poll updates the badge without remounting', async () => {
    let laneStatus = 'plan';
    apiFetchMock.mockImplementation(async (url) => {
      if (url === '/api/projects') return jsonResponse([{ id: 1, repo_path: '/x', app_url: null }]);
      if (url === '/api/projects/1/tracks') {
        return jsonResponse([{ track_number: '1', title: 'App Skeleton', lane_status: laneStatus, waiting_for_reply: false }]);
      }
      // Not a real production call — Vitest's own test-runner cleanup-hook
      // machinery invokes the mock with no arguments during unmount/teardown
      // (confirmed via stack trace: @vitest/runner's callCleanupHooks, not
      // React or this component). Fall back harmlessly instead of throwing.
      return jsonResponse([]);
    });

    render(<FollowBuildView projectId={1} onClose={() => {}} pollIntervalMs={20} />);
    await waitFor(() => expect(screen.getByTestId('follow-build-lane-1')).toHaveTextContent('Plan'));

    laneStatus = 'done';
    await waitFor(() => expect(screen.getByTestId('follow-build-lane-1')).toHaveTextContent('Done'));
  });

  it('TC-13: a track needing input renders "Needs your input" and clicking it fires onOpenTrack', async () => {
    apiFetchMock.mockImplementation(async (url) => {
      if (url === '/api/projects') return jsonResponse([{ id: 1, repo_path: '/x', app_url: null }]);
      if (url === '/api/projects/1/tracks') {
        return jsonResponse([
          { track_number: '2', title: 'Deploy to Firebase Hosting', lane_status: 'quality-gate', waiting_for_reply: false, last_comment_author: 'system', last_comment_body: '❌ QUALITY GATE FAILED' },
        ]);
      }
      // Not a real production call — Vitest's own test-runner cleanup-hook
      // machinery invokes the mock with no arguments during unmount/teardown
      // (confirmed via stack trace: @vitest/runner's callCleanupHooks, not
      // React or this component). Fall back harmlessly instead of throwing.
      return jsonResponse([]);
    });

    const onOpenTrack = vi.fn();
    render(<FollowBuildView projectId={1} onClose={() => {}} onOpenTrack={onOpenTrack} pollIntervalMs={20} />);

    const badge = await screen.findByTestId('follow-build-needs-input-2');
    expect(badge).toHaveTextContent('Needs your input');
    expect(screen.queryByTestId('follow-build-lane-2')).not.toBeInTheDocument();

    badge.click();
    expect(onOpenTrack).toHaveBeenCalledWith('2');
  });

  it('TC-14: shows the placeholder until app_url is set, then a live link with the right href', async () => {
    let appUrl = null;
    apiFetchMock.mockImplementation(async (url) => {
      if (url === '/api/projects') return jsonResponse([{ id: 1, repo_path: '/x', app_url: appUrl }]);
      if (url === '/api/projects/1/tracks') return jsonResponse([]);
      // Not a real production call — Vitest's own test-runner cleanup-hook
      // machinery invokes the mock with no arguments during unmount/teardown
      // (confirmed via stack trace: @vitest/runner's callCleanupHooks, not
      // React or this component). Fall back harmlessly instead of throwing.
      return jsonResponse([]);
    });

    render(<FollowBuildView projectId={1} onClose={() => {}} pollIntervalMs={20} />);
    await waitFor(() => expect(screen.getByTestId('follow-build-app-url')).toHaveTextContent(/will appear here/i));
    expect(screen.queryByTestId('follow-build-live-link')).not.toBeInTheDocument();

    appUrl = 'https://digger-game-prod.web.app';
    await waitFor(() => expect(screen.getByTestId('follow-build-live-link')).toBeInTheDocument());
    expect(screen.getByTestId('follow-build-live-link')).toHaveAttribute('href', 'https://digger-game-prod.web.app');
  });
});
