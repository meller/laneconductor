// Track 10076 (TC-4.10 / REQ-10): pins the transitive fix Phase 4's
// continuous self-heal depends on. A done-lane track the reconciler just
// demoted from done:success to done:queue must be reachable again — the
// ▶ run control (TrackCard.jsx's own gating, unchanged by this track)
// already renders for done + queue/failure, so requeuing alone is enough
// to make the merge action claimable again. This test doesn't exercise
// the reconciler itself (see conductor/tests/track-10076-reconcile-done-status.test.mjs
// for that) — it only pins that TrackCard's existing gate really does
// cover the state the reconciler writes into.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrackCard } from './TrackCard.jsx';

function doneTrack(overrides = {}) {
  return {
    track_number: '801',
    title: 'Requeued after self-heal',
    lane_status: 'done',
    lane_action_status: 'queue',
    track_type: 'dev',
    progress_percent: 100,
    ...overrides,
  };
}

describe('TrackCard — a done-lane track just requeued by the self-heal is reachable (TC-4.10)', () => {
  it('shows the ▶ run control once lane_action_status is queue', () => {
    render(<TrackCard track={doneTrack({ lane_action_status: 'queue' })} />);
    const btn = screen.getByTitle('Run done action for this track');
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('▶');
  });

  it('also shows it for the attempted-and-failed case', () => {
    render(<TrackCard track={doneTrack({ lane_action_status: 'failure' })} />);
    expect(screen.getByTitle('Run done action for this track')).toBeTruthy();
  });

  it('does NOT show it while still done:success (nothing to re-merge)', () => {
    render(<TrackCard track={doneTrack({ lane_action_status: 'success' })} />);
    expect(screen.queryByTitle('Re-run done action for this track')).toBeNull();
    expect(screen.queryByTitle('Run done action for this track')).toBeNull();
  });
});
