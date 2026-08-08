-- Drop "workers_project_id_hostname_pid_key" from table: "workers".
-- Handles both forms it's been observed as across environments: a plain
-- index (DROP INDEX works) or a unique-constraint-backed index (DROP INDEX
-- fails with "constraint ... requires it" -- needs DROP CONSTRAINT instead).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'workers_project_id_hostname_pid_key' AND table_name = 'workers'
  ) THEN
    ALTER TABLE "public"."workers" DROP CONSTRAINT "workers_project_id_hostname_pid_key";
  ELSIF EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'workers_project_id_hostname_pid_key'
  ) THEN
    DROP INDEX "public"."workers_project_id_hostname_pid_key";
  END IF;
END $$;
-- Modify "workers" table
ALTER TABLE "public"."workers" ADD COLUMN "worker_number" integer NOT NULL DEFAULT 1;
-- Create index "workers_project_id_hostname_worker_number_key" to table: "workers"
CREATE UNIQUE INDEX "workers_project_id_hostname_worker_number_key" ON "public"."workers" ("project_id", "hostname", "worker_number");
