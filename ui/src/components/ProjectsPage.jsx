import React from 'react';
import { ProjectCard } from './ProjectCard.jsx';

// Track 10014: overview of all projects. Deliberately fed `projects`,
// `tracks`, `workers` from AppContent's existing usePolling state instead
// of fetching its own summary — usePolling already returns ALL tracks/
// workers (not just the selected project's) whenever no project is
// selected, so per-card stats are computed here with zero extra requests.
export function ProjectsPage({ projects, tracks, workers, onOpen, onManageContext, onRename, onDelete, onNewProject }) {
  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        No projects yet.{' '}
        {onNewProject && (
          <button onClick={onNewProject} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 ml-1">
            Create one
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {projects.map(project => (
        <ProjectCard
          key={project.id}
          project={project}
          tracks={tracks}
          workers={workers}
          onOpen={onOpen}
          onManageContext={onManageContext}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
