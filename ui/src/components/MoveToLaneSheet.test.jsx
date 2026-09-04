import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MoveToLaneSheet } from './MoveToLaneSheet.jsx';
import { LANES } from './KanbanBoard.jsx';

function track(overrides = {}) {
  return {
    track_number: '042',
    lane_status: 'implement',
    lane_action_status: 'waiting',
    ...overrides,
  };
}

describe('MoveToLaneSheet', () => {
  it('TC-3.3: lists all six lanes with the current lane marked and non-selectable', () => {
    render(<MoveToLaneSheet track={track()} onSelect={() => {}} onClose={() => {}} />);
    for (const lane of LANES) {
      expect(screen.getByTestId(`move-sheet-lane-${lane.id}`)).toBeInTheDocument();
    }
    const currentBtn = screen.getByTestId('move-sheet-lane-implement');
    expect(currentBtn).toBeDisabled();
    expect(currentBtn).toHaveTextContent('Current');
  });

  it('TC-3.4: selecting a lane calls onSelect with that lane id', () => {
    const onSelect = vi.fn();
    render(<MoveToLaneSheet track={track()} onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('move-sheet-lane-review'));
    expect(onSelect).toHaveBeenCalledWith('review');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('TC-3.7: a plan track with lane_action_status running disables every lane and states why', () => {
    const onSelect = vi.fn();
    render(
      <MoveToLaneSheet
        track={track({ lane_status: 'plan', lane_action_status: 'running' })}
        onSelect={onSelect}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId('move-sheet-blocked-reason')).toBeInTheDocument();
    for (const lane of LANES) {
      expect(screen.getByTestId(`move-sheet-lane-${lane.id}`)).toBeDisabled();
    }
    fireEvent.click(screen.getByTestId('move-sheet-lane-review'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('TC-3.8: a plan track with lane_action_status success IS movable', () => {
    render(
      <MoveToLaneSheet
        track={track({ lane_status: 'plan', lane_action_status: 'success' })}
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.queryByTestId('move-sheet-blocked-reason')).not.toBeInTheDocument();
    expect(screen.getByTestId('move-sheet-lane-implement')).not.toBeDisabled();
  });

  it('TC-3.9: backdrop tap closes the sheet', () => {
    const onClose = vi.fn();
    render(<MoveToLaneSheet track={track()} onSelect={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('move-sheet-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
