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

  it('REQ-8: renders truncated session ID when turn.sessionId is present', () => {
    const turn = { active: true, startedAt: 0, lastEventAt: 0, outputTokens: 50, sessionId: 'abc12345-6789-extra' };
    render(<TurnStatusBar turn={turn} />);
    expect(screen.getByTestId('turn-session-id')).toHaveTextContent('session: abc12345');
  });

  // Track 10079 — TC-4.1..TC-4.3
  describe('Stop control (Track 10079)', () => {
    it('TC-4.1: with canAbort true, a Stop control renders, present and enabled', () => {
      render(<TurnStatusBar turn={null} canAbort onAbort={() => {}} />);
      const btn = screen.getByTestId('abort-turn-button');
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
      expect(btn).toHaveTextContent('Stop');
    });

    it('TC-4.2: canAbort true with turn null/inactive still renders the bar — regression guard on the old `if (!turn) return null`', () => {
      const { container } = render(<TurnStatusBar turn={null} canAbort onAbort={() => {}} />);
      expect(container).not.toBeEmptyDOMElement();
      expect(screen.getByTestId('abort-turn-button')).toBeInTheDocument();
    });

    it('TC-4.3: canAbort false and no turn data renders nothing — REQ-24 "no empty chrome" preserved', () => {
      const { container } = render(<TurnStatusBar turn={null} canAbort={false} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('TC-4.4: clicking Stop fires onAbort exactly once, and shows "Stopping…" disabled while in flight', () => {
      const onAbort = vi.fn();
      const { rerender } = render(<TurnStatusBar turn={null} canAbort onAbort={onAbort} aborting={false} />);
      const btn = screen.getByTestId('abort-turn-button');
      btn.click();
      expect(onAbort).toHaveBeenCalledTimes(1);

      rerender(<TurnStatusBar turn={null} canAbort onAbort={onAbort} aborting />);
      const inFlight = screen.getByTestId('abort-turn-button');
      expect(inFlight).toHaveTextContent('Stopping…');
      expect(inFlight).toBeDisabled();
    });

    it('TC-4.5: a 409 (nothing running) is surfaced via abortError as informational, not styled as failure of the click itself', () => {
      render(<TurnStatusBar turn={null} canAbort onAbort={() => {}} abortError="Nothing is running" />);
      expect(screen.getByTestId('abort-error')).toHaveTextContent('Nothing is running');
      // The control itself returns to idle — a 409 is not a stuck "Stopping…".
      expect(screen.getByTestId('abort-turn-button')).toHaveTextContent('Stop');
      expect(screen.getByTestId('abort-turn-button')).not.toBeDisabled();
    });

    it('TC-4.6: a 500 surfaces the server message and the control returns to idle so a retry is possible', () => {
      render(<TurnStatusBar turn={null} canAbort onAbort={() => {}} aborting={false} abortError="Internal error: boom" />);
      expect(screen.getByTestId('abort-error')).toHaveTextContent('Internal error: boom');
      expect(screen.getByTestId('abort-turn-button')).not.toBeDisabled();
    });
  });
});
