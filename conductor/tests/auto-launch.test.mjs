import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Test suite for auto-launch parallel limit enforcement
 *
 * Tests the logic that prevents multiple tracks from the same lane
 * from launching simultaneously when parallel_limit is set.
 */

describe('Auto-Launch Parallel Limit Enforcement', () => {
  let currentlyRunningPerLane;
  let lanesClaimedThisIteration;
  let workflowConfig;
  let spawnedTracks;

  beforeEach(() => {
    // Reset test state before each test
    currentlyRunningPerLane = {};
    lanesClaimedThisIteration = new Map();
    spawnedTracks = [];
    workflowConfig = {
      defaults: { parallel_limit: 1 },
      lanes: {
        planning: { parallel_limit: 1, auto_action: 'planning' },
        'in-progress': { parallel_limit: 1, auto_action: 'implement' },
        review: { parallel_limit: 1, auto_action: 'review' },
        'quality-gate': { parallel_limit: 1, auto_action: 'quality-gate' },
      },
    };
  });

  /**
   * Simulates the auto-launch safety check:
   * Given running tracks in each lane, and a new track to claim,
   * should spawn only if the lane has room
   */
  const shouldSpawnTrack = (trackLane) => {
    const laneLimit = workflowConfig.lanes[trackLane]?.parallel_limit ?? 1;
    const alreadyRunning = currentlyRunningPerLane[trackLane] || 0;
    const alreadyClaimedThisRound = lanesClaimedThisIteration.get(trackLane) || 0;
    const wouldBeRunning = alreadyRunning + alreadyClaimedThisRound;

    // This mirrors the check at line 1057 in laneconductor.sync.mjs
    return wouldBeRunning < laneLimit;
  };

  /**
   * Simulates spawning a track (adds to tracking maps)
   */
  const spawnTrack = (trackNumber, trackLane) => {
    if (!shouldSpawnTrack(trackLane)) {
      return null; // Track was not spawned due to limit
    }

    // Simulate spawn: increment claimed this round
    lanesClaimedThisIteration.set(
      trackLane,
      (lanesClaimedThisIteration.get(trackLane) || 0) + 1
    );

    // Track the spawn
    spawnedTracks.push({ trackNumber, trackLane });
    return { trackNumber, trackLane, pid: 1000 + spawnedTracks.length };
  };

  /**
   * Simulates end of iteration: move claimed counts to running
   */
  const endIteration = () => {
    for (const [lane, claimedCount] of lanesClaimedThisIteration.entries()) {
      currentlyRunningPerLane[lane] = (currentlyRunningPerLane[lane] || 0) + claimedCount;
    }
    lanesClaimedThisIteration.clear();
  };

  it('should spawn 1st planning track when lane has room', () => {
    // Iteration 1: No planning tracks running, lane limit is 1
    const track1 = spawnTrack(1, 'planning');
    expect(track1).not.toBeNull();
    expect(track1.trackNumber).toBe(1);
    expect(spawnedTracks.length).toBe(1);
  });

  it('should NOT spawn 2nd planning track in same iteration when limit=1', () => {
    // Iteration 1: Spawn 1st planning track
    spawnTrack(1, 'planning');
    endIteration();

    // Still iteration 1: Try to spawn 2nd planning track
    // Now currentlyRunningPerLane[planning] = 1 (from previous spawn)
    const track2 = spawnTrack(2, 'planning');
    expect(track2).toBeNull();
    expect(spawnedTracks.length).toBe(1); // Only 1st track spawned
  });

  it('should spawn 2nd planning track in next iteration after 1st completes', () => {
    // Iteration 1: Spawn 1st planning track
    spawnTrack(1, 'planning');
    endIteration();

    // Iteration 2: 1st track still running (assume it hasn't exited)
    const track2 = spawnTrack(2, 'planning');
    expect(track2).toBeNull(); // Can't spawn yet

    // Simulate 1st track exiting: decrement running count
    currentlyRunningPerLane['planning'] -= 1;

    // Iteration 3: Now 1st track has exited, room for 2nd
    const track2Retry = spawnTrack(2, 'planning');
    expect(track2Retry).not.toBeNull();
    expect(track2Retry.trackNumber).toBe(2);
    expect(spawnedTracks.length).toBe(2);
  });

  it('should respect per-lane limits independently', () => {
    // Iteration 1: Spawn 1 planning track AND 1 review track
    spawnTrack(1, 'planning');
    spawnTrack(1, 'review');
    endIteration();

    expect(spawnedTracks.length).toBe(2);
    expect(currentlyRunningPerLane['planning']).toBe(1);
    expect(currentlyRunningPerLane['review']).toBe(1);

    // Iteration 2: Try to spawn 2nd planning AND 2nd review
    const track2Planning = spawnTrack(2, 'planning');
    const track2Review = spawnTrack(2, 'review');

    expect(track2Planning).toBeNull(); // Planning at limit
    expect(track2Review).toBeNull(); // Review at limit
    expect(spawnedTracks.length).toBe(2); // No new tracks spawned
  });

  it('should handle higher parallel limits (parallel_limit=2)', () => {
    // Change planning limit to 2
    workflowConfig.lanes.planning.parallel_limit = 2;

    // Iteration 1: Spawn 1st planning track
    spawnTrack(1, 'planning');
    endIteration();

    // Still same iteration? No - this is between iterations
    // Iteration 2: Spawn 2nd planning track (room for 2)
    const track2 = spawnTrack(2, 'planning');
    expect(track2).not.toBeNull();
    expect(spawnedTracks.length).toBe(2);

    endIteration();

    // Iteration 3: Try 3rd planning track (should fail, limit is 2)
    const track3 = spawnTrack(3, 'planning');
    expect(track3).toBeNull();
    expect(spawnedTracks.length).toBe(2);
  });

  it('should NOT spawn if would exceed lane limit with already-claimed tracks', () => {
    // Simulate a lane where we've already claimed 1 track this iteration
    lanesClaimedThisIteration.set('planning', 1);

    // Try to claim another planning track in same iteration
    const track2 = spawnTrack(2, 'planning');
    expect(track2).toBeNull(); // Should fail: 0 running + 1 already claimed = 1 (at limit)
  });

  it('should handle complex scenario: multiple lanes with different limits', () => {
    // Setup: planning limit=1, in-progress limit=2, review limit=1
    workflowConfig.lanes['in-progress'].parallel_limit = 2;

    // Iteration 1: Spawn from all lanes
    spawnTrack(1, 'planning');
    spawnTrack(1, 'in-progress');
    spawnTrack(1, 'in-progress'); // Should succeed (limit=2)
    spawnTrack(1, 'review');
    endIteration();

    expect(spawnedTracks.length).toBe(4);
    expect(currentlyRunningPerLane['planning']).toBe(1);
    expect(currentlyRunningPerLane['in-progress']).toBe(2);
    expect(currentlyRunningPerLane['review']).toBe(1);

    // Iteration 2: Try to spawn more from each lane
    const planning2 = spawnTrack(2, 'planning'); // At limit
    const inProgress3 = spawnTrack(3, 'in-progress'); // At limit
    const review2 = spawnTrack(2, 'review'); // At limit

    expect(planning2).toBeNull();
    expect(inProgress3).toBeNull();
    expect(review2).toBeNull();
    expect(spawnedTracks.length).toBe(4); // No new spawns
  });

  it('should correctly count running tracks from multiple sources', () => {
    // Setup: Simulate lanes with running tracks from different sources
    currentlyRunningPerLane['planning'] = 1;
    currentlyRunningPerLane['in-progress'] = 0;

    // When planning is at capacity and in-progress has room
    const planningTrack = spawnTrack(1, 'planning');
    const inProgressTrack = spawnTrack(1, 'in-progress');

    expect(planningTrack).toBeNull(); // Planning at limit
    expect(inProgressTrack).not.toBeNull(); // In-progress has room
    expect(spawnedTracks.length).toBe(1);
  });

  it('should prevent race condition: claimed + running >= limit', () => {
    // Start with 0 running in planning lane
    currentlyRunningPerLane['planning'] = 0;

    // Claim and spawn 1st track
    spawnTrack(1, 'planning');
    // lanesClaimedThisIteration is now { planning: 1 }

    // Claim 2nd track in same iteration
    // Check: alreadyRunning(0) + alreadyClaimedThisRound(1) = 1 >= limit(1)
    const track2 = spawnTrack(2, 'planning');
    expect(track2).toBeNull(); // Should be prevented by the race condition check
  });
});
