-- Migration: Add cli and model columns to workers table
-- Track 1096: Worker CLI and Model Picker

ALTER TABLE workers ADD COLUMN IF NOT EXISTS cli TEXT;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS model TEXT;
