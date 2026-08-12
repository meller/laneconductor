-- Track 1096 Phase 6: Dynamic model discovery
-- Stores the list of models a worker reports as available on its machine.
-- Populated via heartbeat; null means "use UI presets" (worker hasn't
-- run discovery yet or its CLI doesn't support model listing).
ALTER TABLE workers ADD COLUMN IF NOT EXISTS available_models JSONB;
