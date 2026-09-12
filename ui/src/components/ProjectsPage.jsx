import React from 'react';
import { ProjectCard } from './ProjectCard.jsx';

// Track 10014 / AM-10094: overview of all projects. Fed `projects` and
// `workers` from AppContent's existing usePolling state (workers are still
// fetched unscoped — needed for the online/active status badge), but
// per-card lane counts and unreplied totals now come from
// GET /api/projects/summary (`projectSummaries`) rather than filtering a
// full row-per-track fetch client-side — that fetch is skipped entirely
// while this view is showing (see usePolling's summaryOnly option).
export function ProjectsPage({ projects, projectSummaries, workers, onOpen, onManageContext, onRename, onDelete, onNewProject }) {
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

  const summaryByProject = new Map((projectSummaries || []).map(s => [s.id, s]));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {projects.map(project => (
        <ProjectCard
          key={project.id}
          project={project}
          summary={summaryByProject.get(project.id)}
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
