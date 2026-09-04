import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileTabBar, MOBILE_TABS } from './MobileTabBar.jsx';

describe('MobileTabBar', () => {
  it('TC-1.3: renders exactly four tabs, in order: Focus, Board, Workers, More', () => {
    render(<MobileTabBar active="focus" onSelect={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(MOBILE_TABS.map(t => t.label)).toEqual(['Focus', 'Board', 'Workers', 'More']);
  });

  it('TC-1.4: each tab measures at least 44px in the min-height utility class', () => {
    render(<MobileTabBar active="focus" onSelect={() => {}} />);
    for (const tab of MOBILE_TABS) {
      const btn = screen.getByTestId(`mobile-tab-${tab.id}`);
      expect(btn.className).toMatch(/min-h-11/);
    }
  });

  it('TC-1.5: clicking a tab calls onSelect with that tab id exactly once', () => {
    const onSelect = vi.fn();
    render(<MobileTabBar active="focus" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('mobile-tab-board'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('board');
  });

  it('TC-1.6: carries md:hidden so it is not shown at desktop width', () => {
    render(<MobileTabBar active="focus" onSelect={() => {}} />);
    expect(screen.getByTestId('mobile-tab-bar').className).toMatch(/md:hidden/);
  });
});
