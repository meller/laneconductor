# Tests: Track AM-1120 — Wizard Real-Deploy Verification

## Test Commands

```bash
# Fetch the recorded app_url once the deploy track reports done
curl -I "$APP_URL"

# Confirm generated tracks all reached done
psql "$DATABASE_URL" -c "select track_number, title, lane_status from tracks where project_id = <new-project-id> order by track_number;"
```

## Test Cases

- [ ] TC-1: A disposable Firebase/GCP project is confirmed, distinct from
      laneconductor-site/makrodash/ocumentor-prod/otralingo — expected: project id recorded in
      plan.md Phase 1
- [ ] TC-2 (was 1119's TC-16): Full wizard run with a digger-game description against the
      disposable project — expected: every generated track reaches `done` without manual
      intervention beyond Launch
- [ ] TC-3: `curl -I $app_url` (or equivalent) — expected: HTTP response confirming the app is
      actually reachable, not just that a URL string exists
- [ ] TC-4: `FollowBuildView` (track 1119 Phase 5) shows the live link once the deploy track
      completes — expected: observed and recorded (screenshot or transcript)

## Acceptance Criteria
- [ ] All test cases above recorded with real observations in conversation.md (pass or fail —
      a failure here is still a completed, valuable result: it means track 1119 has a real bug)
