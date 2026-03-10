import React from 'react';

export function ProjectSelector({ projects, selectedId, onChange }) {
  return (
    <select
      value={selectedId ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      className="bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-lg
                 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <option value="">All Projects</option>
      {projects.map(p => (
        <option key={p.id} value={p.id}>
          {p.name} {p.agent && p.agent !== 'claude' ? `(${p.agent})` : ''}
        </option>
      ))}
    </select>
  );
}
