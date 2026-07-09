-- Auto-bump content_updated_at only when tracked content actually changes,
-- regardless of which endpoint/code path performs the UPDATE. Fixes a bug
-- where last_heartbeat (bumped by ANY worker activity, including pure
-- liveness pings with no content change) was being used as the file<->DB
-- sync "last updated" comparison — a heartbeat ping moments after a fresh
-- local file edit would make the DB look newer and the sync worker would
-- overwrite the just-edited file with stale DB content.
CREATE OR REPLACE FUNCTION tracks_touch_content_updated_at() RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.lane_status IS DISTINCT FROM OLD.lane_status)
     OR (NEW.lane_action_status IS DISTINCT FROM OLD.lane_action_status)
     OR (NEW.progress_percent IS DISTINCT FROM OLD.progress_percent)
     OR (NEW.current_phase IS DISTINCT FROM OLD.current_phase)
     OR (NEW.content_summary IS DISTINCT FROM OLD.content_summary)
     OR (NEW.index_content IS DISTINCT FROM OLD.index_content)
     OR (NEW.plan_content IS DISTINCT FROM OLD.plan_content)
     OR (NEW.spec_content IS DISTINCT FROM OLD.spec_content)
     OR (NEW.test_content IS DISTINCT FROM OLD.test_content)
  THEN
    NEW.content_updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tracks_content_updated_at ON "public"."tracks";

CREATE TRIGGER trg_tracks_content_updated_at
BEFORE UPDATE ON "public"."tracks"
FOR EACH ROW
EXECUTE FUNCTION tracks_touch_content_updated_at();
