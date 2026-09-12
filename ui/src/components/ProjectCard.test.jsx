// Track 10014 / AM-10094: ProjectCard reads its per-project stats from a
// `summary` row (GET /api/projects/summary — one set-based query
// server-side) instead of filtering a full unscoped tracks array
// client-side. No per-card fetch either way.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectCard } from './ProjectCard.jsx';

const project = { id: 1, name: 'Alpha', repo_path: '/repo/alpha', primary_cli: 'claude', primary_model: 'sonnet' };

function noop() {}

describe('ProjectCard', () => {
  it('TC-11: lane-count chips reflect the summary row for this project', () => {
    const summary = { id: 1, total: 3, implement: 2, done: 1, unreplied_total: 0 };

    render(<ProjectCard project={project} summary={summary} workers={[]} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />);

    expect(screen.getByTestId('lane-chip-implement')).toHaveTextContent('2');
    expect(screen.getByTestId('lane-chip-done')).toHaveTextContent('1');
    expect(screen.queryByTestId('lane-chip-review')).not.toBeInTheDocument();
  });

  it('TC-12: a worker heartbeating 30s ago shows Active/online; 120s ago shows Offline', () => {
    const summary = { id: 1, total: 0, unreplied_total: 0 };
    const recentWorker = [{ project_id: 1, last_heartbeat: new Date(Date.now() - 30_000).toISOString() }];
    const { rerender } = render(
      <ProjectCard project={project} summary={summary} workers={recentWorker} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />
    );
    expect(screen.getByTestId('project-status-badge')).toHaveTextContent(/active|idle/i);

    const staleWorker = [{ project_id: 1, last_heartbeat: new Date(Date.now() - 120_000).toISOString() }];
    rerender(
      <ProjectCard project={project} summary={summary} workers={staleWorker} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />
    );
    expect(screen.getByTestId('project-status-badge')).toHaveTextContent(/offline/i);
  });

  it('counts unreplied comments from the summary row\'s unreplied_total', () => {
    const summary = { id: 1, total: 1, review: 1, unreplied_total: 2 };
    render(<ProjectCard project={project} summary={summary} workers={[]} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />);
    expect(screen.getByTestId('project-unreplied-count')).toHaveTextContent('2');
  });

  it('shows "No tracks yet" when the summary total is zero', () => {
    const summary = { id: 1, total: 0, unreplied_total: 0 };
    render(<ProjectCard project={project} summary={summary} workers={[]} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />);
    expect(screen.getByText('No tracks yet')).toBeInTheDocument();
  });

  it('renders sensibly when the summary hasn\'t loaded yet (undefined)', () => {
    render(<ProjectCard project={project} summary={undefined} workers={[]} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />);
    expect(screen.getByText('No tracks yet')).toBeInTheDocument();
  });

  // Track AM-1119 Phase 4 (Task 3, TC-11): "Live ↗" link only when app_url is set.
  it('TC-11 (AM-1119): shows no Live link when app_url is not set', () => {
    render(<ProjectCard project={project} summary={{ id: 1, total: 0 }} workers={[]} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />);
    expect(screen.queryByTestId('project-live-link')).not.toBeInTheDocument();
  });

  it('TC-11 (AM-1119): shows a Live link pointing at app_url once set', () => {
    const deployedProject = { ...project, app_url: 'https://digger-game-prod.web.app' };
    render(<ProjectCard project={deployedProject} summary={{ id: 1, total: 0 }} workers={[]} onOpen={noop} onManageContext={noop} onRename={noop} onDelete={noop} />);
    const link = screen.getByTestId('project-live-link');
    expect(link).toHaveAttribute('href', 'https://digger-game-prod.web.app');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
