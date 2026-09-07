import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TurnStatusBar } from './TurnStatusBar.jsx';

describe('TurnStatusBar', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders nothing when there is no turn', () => {
    const { container } = render(<TurnStatusBar turn={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('REQ-24: renders nothing for an inactive turn with no tokens ever seen (non-Claude raw-log run)', () => {
    const { container } = render(<TurnStatusBar turn={{ active: false, outputTokens: 0, contextTokens: null, startedAt: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('TC-2.9: an active turn renders an elapsed value that advances across a fake-timer tick', () => {
    vi.setSystemTime(10_000);
    const turn = { active: true, startedAt: 10_000, lastEventAt: 10_000, outputTokens: 5, contextTokens: null, activity: 'Thinking…' };
    render(<TurnStatusBar turn={turn} />);
    expect(screen.getByText('0:00')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('0:03')).toBeInTheDocument();
  });

  it('TC-2.9: an inactive (ended) turn renders a frozen value and does not tick', () => {
    vi.setSystemTime(20_000);
    const turn = { active: false, startedAt: 10_000, lastEventAt: 15_000, outputTokens: 100, contextTokens: 5000, activity: null };
    render(<TurnStatusBar turn={turn} />);
    expect(screen.getByText('0:05')).toBeInTheDocument(); // lastEventAt - startedAt = 5s, not now - startedAt

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('0:05')).toBeInTheDocument(); // still frozen
  });

  it('renders the token count and activity label', () => {
    const turn = { active: true, startedAt: 0, lastEventAt: 0, outputTokens: 1234, contextTokens: null, activity: 'Read' };
    render(<TurnStatusBar turn={turn} />);
    expect(screen.getByText('1,234 tokens')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
  });
});
