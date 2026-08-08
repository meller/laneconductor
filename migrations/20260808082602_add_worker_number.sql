-- Drop unique constraint "workers_project_id_hostname_pid_key" from table: "workers"
-- (constraint-backed, not a plain index -- DROP INDEX fails with
-- "constraint ... requires it"; must drop the constraint directly)
ALTER TABLE "public"."workers" DROP CONSTRAINT "workers_project_id_hostname_pid_key";
-- Modify "workers" table
ALTER TABLE "public"."workers" ADD COLUMN "worker_number" integer NOT NULL DEFAULT 1;
-- Create index "workers_project_id_hostname_worker_number_key" to table: "workers"
CREATE UNIQUE INDEX "workers_project_id_hostname_worker_number_key" ON "public"."workers" ("project_id", "hostname", "worker_number");
