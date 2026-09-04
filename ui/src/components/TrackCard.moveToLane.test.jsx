// Track 1121 Phase 3: TrackCard's touch move affordance. Additive to the
// existing draggable/onDragStart — desktop drag-drop is untouched.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrackCard } from './TrackCard.jsx';

function baseTrack(overrides = {}) {
  return {
    track_number: '001',
    title: 'Some track',
    lane_status: 'implement',
    lane_action_status: 'waiting',
    track_type: 'dev',
    progress_percent: 20,
    ...overrides,
  };
}

describe('TrackCard — tap-to-move (Track 1121 Phase 3)', () => {
  it('TC-3.1: the move affordance carries md:hidden (hidden at desktop width)', () => {
    render(<TrackCard track={baseTrack()} onClick={() => {}} onLaneChange={() => {}} />);
    expect(screen.getByTestId('track-card-move-btn').className).toMatch(/md:hidden/);
  });

  it('TC-3.2: tapping the move affordance opens the sheet and does not open the detail panel', () => {
    const onClick = vi.fn();
    render(<TrackCard track={baseTrack()} onClick={onClick} onLaneChange={() => {}} />);
    fireEvent.click(screen.getByTestId('track-card-move-btn'));
    expect(screen.getByTestId('move-to-lane-sheet')).toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('TC-3.4/TC-3.5: selecting a lane in the sheet calls onLaneChange(track, targetLane) and nothing else', () => {
    const onLaneChange = vi.fn();
    const track = baseTrack();
    render(<TrackCard track={track} onClick={() => {}} onLaneChange={onLaneChange} />);
    fireEvent.click(screen.getByTestId('track-card-move-btn'));
    fireEvent.click(screen.getByTestId('move-sheet-lane-review'));
    expect(onLaneChange).toHaveBeenCalledTimes(1);
    expect(onLaneChange).toHaveBeenCalledWith(track, 'review');
  });

  it('closes the sheet after a successful move selection', () => {
    render(<TrackCard track={baseTrack()} onClick={() => {}} onLaneChange={() => {}} />);
    fireEvent.click(screen.getByTestId('track-card-move-btn'));
    fireEvent.click(screen.getByTestId('move-sheet-lane-review'));
    expect(screen.queryByTestId('move-to-lane-sheet')).not.toBeInTheDocument();
  });

  it('TC-3.7: a plan+running track shows the sheet in its blocked state', () => {
    render(
      <TrackCard
        track={baseTrack({ lane_status: 'plan', lane_action_status: 'running' })}
        onClick={() => {}}
        onLaneChange={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('track-card-move-btn'));
    expect(screen.getByTestId('move-sheet-blocked-reason')).toBeInTheDocument();
  });
});
