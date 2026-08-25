-- Track 1102 F10c: deleting a workers row cascaded away every
-- worker_dispatch row for it — including all worker_adhoc_chat history the
-- Activity panel reads through it. F10's soft de-registration avoids this
-- on the routine stop path, but a manual row deletion can still hit it.
-- worker_id must be nullable for a SET NULL action to be valid.
ALTER TABLE "public"."worker_dispatch" ALTER COLUMN "worker_id" DROP NOT NULL;
ALTER TABLE "public"."worker_dispatch" DROP CONSTRAINT "worker_dispatch_worker_id_fkey";
ALTER TABLE "public"."worker_dispatch" ADD CONSTRAINT "worker_dispatch_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
