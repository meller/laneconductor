-- Modify "workers" table
ALTER TABLE "public"."workers" ADD COLUMN "type" text NOT NULL DEFAULT 'project';
-- Create index "workers_one_manager_per_host" to table: "workers"
CREATE UNIQUE INDEX "workers_one_manager_per_host" ON "public"."workers" ("hostname") WHERE (type = 'manager'::text);
