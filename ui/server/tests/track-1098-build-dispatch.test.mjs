import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createBuildArtifact, getBuilds, getBuildById } from '../build-manager.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Track 1098 & 1097 Build Manager Artifacts', () => {
  let tempRepo;

  beforeAll(() => {
    tempRepo = mkdtempSync(join(tmpdir(), 'lc-build-test-'));
    mkdirSync(join(tempRepo, 'conductor', 'tracks', '1001-test-track'), { recursive: true });
    writeFileSync(
      join(tempRepo, 'conductor', 'tracks', '1001-test-track', 'index.md'),
      '# Track 1001: Test Track\n**Lane**: complete\n**Summary**: Initial test track feature.\n'
    );
  });

  afterAll(() => {
    if (tempRepo) {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it('creates a build artifact with AI-synthesized release summary', () => {
    const artifact = createBuildArtifact(tempRepo, { createdBy: 'Test Runner' });
    expect(artifact.id.startsWith('build-')).toBe(true);
    expect(artifact.createdAt).toBeDefined();
    expect(artifact.summary).toBeDefined();
    expect(artifact.summary.title).toBeDefined();
    expect(Array.isArray(artifact.tracks)).toBe(true);
    expect(artifact.createdBy).toBe('Test Runner');

    const fetched = getBuildById(tempRepo, artifact.id);
    expect(fetched.id).toBe(artifact.id);

    const allBuilds = getBuilds(tempRepo);
    expect(allBuilds.length).toBe(1);
    expect(allBuilds[0].id).toBe(artifact.id);
  });
});
