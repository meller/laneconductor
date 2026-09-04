import React from 'react';

export const MOBILE_TABS = [
  { id: 'focus', label: 'Focus', icon: '🎯' },
  { id: 'board', label: 'Board', icon: '📋' },
  { id: 'workers', label: 'Workers', icon: '⚙️' },
  { id: 'more', label: 'More', icon: '⋯' },
];

// Track 1121 Phase 1: bottom tab nav, mobile-only (md:hidden). Drives the
// same viewMode/mobileTab state App.jsx already has — this is navigation
// chrome, not a second source of truth for "what screen is showing".
export function MobileTabBar({ active, onSelect }) {
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-gray-950 border-t border-gray-800 flex"
      data-testid="mobile-tab-bar"
    >
      {MOBILE_TABS.map(tab => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            data-testid={`mobile-tab-${tab.id}`}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-11 py-1.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
              isActive ? 'text-blue-400' : 'text-gray-500'
            }`}
          >
            <span className="text-base leading-none" aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
