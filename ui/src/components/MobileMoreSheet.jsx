import React from 'react';

// Track 1121 Phase 1: mobile-only overflow sheet. Each entry calls the exact
// same setter the desktop header button for that destination calls — this
// is a second entry point into existing navigation state, not a second
// navigation model.
export function MobileMoreSheet({ onClose, onNavigate, onOpenConductor, onOpenWorkflow, onOpenConfig, onOpenInbox, onOpenAccount, onOpenActivity, showAccount }) {
  const items = [
    { key: 'projects', label: '📁 Projects', onClick: () => onNavigate('projects') },
    { key: 'cicd', label: '🚀 CI/CD', onClick: () => onNavigate('cicd') },
    { key: 'worktrees', label: '🌳 Worktrees', onClick: () => onNavigate('worktrees') },
    { key: 'context', label: '📄 Context', onClick: onOpenConductor },
    { key: 'workflow', label: '⚙️ Workflow', onClick: onOpenWorkflow },
    { key: 'config', label: '⚙️ Config', onClick: onOpenConfig },
    { key: 'activity', label: '⚡ Activity', onClick: onOpenActivity },
    { key: 'inbox', label: '📥 Inbox', onClick: onOpenInbox },
    ...(showAccount ? [{ key: 'account', label: '👤 Account', onClick: onOpenAccount }] : []),
  ].filter(item => typeof item.onClick === 'function');

  function handleSelect(onClick) {
    onClick();
    onClose();
  }

  return (
    <div className="md:hidden fixed inset-0 z-40" data-testid="mobile-more-sheet">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} data-testid="mobile-more-backdrop" />
      <div className="absolute bottom-0 inset-x-0 bg-gray-950 border-t border-gray-800 rounded-t-xl pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">More</span>
          <button
            onClick={onClose}
            className="min-h-11 min-w-11 flex items-center justify-center text-gray-500 hover:text-gray-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="py-2">
          {items.map(item => (
            <button
              key={item.key}
              onClick={() => handleSelect(item.onClick)}
              data-testid={`mobile-more-${item.key}`}
              className="w-full text-left px-4 min-h-11 flex items-center text-sm text-gray-200 hover:bg-gray-900"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
