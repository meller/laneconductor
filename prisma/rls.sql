-- Enable RLS on application tables to fix Supabase security advisor warnings.
ALTER TABLE "public"."api_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."track_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tracks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."workers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."workspace_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;
