-- Migration: Per-track model override
-- Track 1116 REQ-7: lets a human pin a specific model for one track,
-- overriding the lane/project/meta-level model resolution order
-- (conductor/workflow.md's "Model Overrides" section). NULL = no override
-- (the normal case), which falls through to the existing resolution chain
-- unchanged. Backing column for PATCH /api/projects/:id/tracks/:num/model-override
-- and its **Model** index.md marker (see syncTrackToFile).

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS model_override TEXT;
