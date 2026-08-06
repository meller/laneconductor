import React from 'react';

export function BoardToolbar({ sortBy, sortDir, onSortByChange, onSortDirToggle, searchText, onSearchTextChange }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <input
        type="text"
        value={searchText}
        onChange={e => onSearchTextChange(e.target.value)}
        placeholder="Search by title or track #…"
        className="w-64 text-xs bg-gray-900 border border-gray-800 rounded-md px-3 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600"
      />
      <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-md p-0.5">
        <button
          onClick={() => onSortByChange('track_number')}
          className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded transition-colors ${sortBy === 'track_number' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
        >
          Track #
        </button>
        <button
          onClick={() => onSortByChange('date')}
          className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded transition-colors ${sortBy === 'date' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
        >
          Date
        </button>
      </div>
      <button
        onClick={onSortDirToggle}
        title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
        className="text-xs bg-gray-900 border border-gray-800 rounded-md px-2.5 py-1.5 text-gray-400 hover:text-gray-200 transition-colors"
      >
        {sortDir === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  );
}
