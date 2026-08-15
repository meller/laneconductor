// Track 1102 F2: the plan-lane "→" arrow's tooltip always says "Plan in
// progress..." whenever lane_action_status !== 'success' — including
// 'queue' (nothing has ever run) and 'failure' (it ran and broke), not
// just 'running'. Combined with F1, a freshly-queued or failed plan track
// shows a permanently disabled button claiming work is happening when
// nothing is.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrackCard } from './TrackCard.jsx';

function baseTrack(overrides = {}) {
  return {
    track_number: '001',
    title: 'Some track',
    lane_status: 'plan',
    lane_action_status: 'queue',
    track_type: 'dev',
    progress_percent: 0,
    ...overrides,
  };
}

describe('TrackCard — F2 plan-lane next-arrow tooltip accuracy', () => {
  it('says the plan is queued, not "in progress", when lane_action_status is queue', () => {
    render(<TrackCard track={baseTrack({ lane_action_status: 'queue' })} />);
    const arrow = screen.getByText('→');
    expect(arrow.title).not.toBe('Plan in progress...');
    expect(arrow.title).toMatch(/queued/i);
  });

  it('says the plan failed, not "in progress", when lane_action_status is failure', () => {
    render(<TrackCard track={baseTrack({ lane_action_status: 'failure' })} />);
    const arrow = screen.getByText('→');
    expect(arrow.title).not.toBe('Plan in progress...');
    expect(arrow.title).toMatch(/failed/i);
  });

  it('still says "Plan in progress..." when the plan action is actually running', () => {
    render(<TrackCard track={baseTrack({ lane_action_status: 'running' })} />);
    const arrow = screen.getByText('→');
    expect(arrow.title).toBe('Plan in progress...');
  });

  it('the arrow is enabled with its normal move tooltip once the plan succeeded', () => {
    render(<TrackCard track={baseTrack({ lane_action_status: 'success' })} />);
    const arrow = screen.getByText('→');
    expect(arrow.disabled).toBe(false);
    expect(arrow.title).toBe('Move this card to the Start lane');
  });

  it('the arrow stays disabled while queued/failed (only the tooltip changes, not the gating)', () => {
    render(<TrackCard track={baseTrack({ lane_action_status: 'queue' })} />);
    expect(screen.getByText('→').disabled).toBe(true);
  });
});
