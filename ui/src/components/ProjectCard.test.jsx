// Track 10014: ProjectCard computes its stats client-side from data the app
// already polls (projects/tracks/workers) — no per-card fetch.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectCard } from './ProjectCard.jsx';

const project = { id: 1, name: 'Alpha', repo_path: '/repo/alpha', primary_cli: 'claude', primary_model: 'sonnet' };
const otherProject = { id: 2, name: 'Beta', repo_path: '/repo/beta' };

function noop() {}

describe('ProjectCard', () => {
  it('TC-11: lane-count chips reflect only this project\'s tracks, not tracks from other projects', () => {
    const tracks = [
      { project_id: 1, track_number: '1', lane_status: 'implement', unreplied_count: 0 },
      { project_id: 1, track_number: '2', lane_status: 'implement', unreplied_count: 0 },
      { project_id: 1, track_number: '3', lane_status: 'done', unreplied_count: 0 },
      { project_id: 2, track_number: '9', lane_status: 'implement', unreplied_count: 0 },
      { project_id: 2, track_number: '10', lane_status: 'implement', unreplied_count: 0 },
      { project_id: 2, track_number: '11', lane_status: 'implement', unreplied_count: 0 },
    ];

    render(<ProjectCard project={project} tracks={tracks} workers={[]} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />);

    expect(screen.getByTestId('lane-chip-implement')).toHaveTextContent('2');
    expect(screen.getByTestId('lane-chip-done')).toHaveTextContent('1');
    expect(screen.queryByTestId('lane-chip-review')).not.toBeInTheDocument();
  });

  it('TC-12: a worker heartbeating 30s ago shows Active/online; 120s ago shows Offline', () => {
    const recentWorker = [{ project_id: 1, last_heartbeat: new Date(Date.now() - 30_000).toISOString() }];
    const { rerender } = render(
      <ProjectCard project={project} tracks={[]} workers={recentWorker} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />
    );
    expect(screen.getByTestId('project-status-badge')).toHaveTextContent(/active|idle/i);

    const staleWorker = [{ project_id: 1, last_heartbeat: new Date(Date.now() - 120_000).toISOString() }];
    rerender(
      <ProjectCard project={project} tracks={[]} workers={staleWorker} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />
    );
    expect(screen.getByTestId('project-status-badge')).toHaveTextContent(/offline/i);
  });

  it('counts unreplied comments only for this project\'s tracks', () => {
    const tracks = [
      { project_id: 1, track_number: '1', lane_status: 'review', unreplied_count: 2 },
      { project_id: 2, track_number: '9', lane_status: 'review', unreplied_count: 5 },
    ];
    render(<ProjectCard project={project} tracks={tracks} workers={[]} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />);
    expect(screen.getByTestId('project-unreplied-count')).toHaveTextContent('2');
  });
});
