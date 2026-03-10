-- Modify "api_keys" table
ALTER TABLE "public"."api_keys" ALTER COLUMN "user_uid" DROP NOT NULL;
