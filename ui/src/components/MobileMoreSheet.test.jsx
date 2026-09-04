import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileMoreSheet } from './MobileMoreSheet.jsx';

function setup(overrides = {}) {
  const props = {
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onOpenConductor: vi.fn(),
    onOpenWorkflow: vi.fn(),
    onOpenConfig: vi.fn(),
    onOpenInbox: vi.fn(),
    onOpenActivity: vi.fn(),
    onOpenAccount: vi.fn(),
    showAccount: true,
    ...overrides,
  };
  render(<MobileMoreSheet {...props} />);
  return props;
}

describe('MobileMoreSheet', () => {
  it('TC-1.7: lists Projects, CI/CD, Worktrees, Inbox, Account', () => {
    setup();
    expect(screen.getByTestId('mobile-more-projects')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-more-cicd')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-more-worktrees')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-more-inbox')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-more-account')).toBeInTheDocument();
  });

  it('TC-1.7b: each entry invokes the same setter the desktop header uses, then closes', () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('mobile-more-projects'));
    expect(props.onNavigate).toHaveBeenCalledWith('projects');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('TC-1.7c: omits Account when showAccount is false', () => {
    setup({ showAccount: false });
    expect(screen.queryByTestId('mobile-more-account')).not.toBeInTheDocument();
  });

  it('backdrop tap closes the sheet', () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('mobile-more-backdrop'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('close button is at least 44px via min-h-11/min-w-11', () => {
    setup();
    const closeBtn = screen.getByLabelText('Close');
    expect(closeBtn.className).toMatch(/min-h-11/);
    expect(closeBtn.className).toMatch(/min-w-11/);
  });
});
