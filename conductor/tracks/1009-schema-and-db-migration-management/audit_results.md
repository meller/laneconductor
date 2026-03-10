# Database Schema Audit

Generated on: 2026-02-27T07:06:27.707Z

## Table: projects

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | integer | NO | nextval('projects_id_seq'::regclass) |
| name | text | NO |  |
| repo_path | text | NO |  |
| git_remote | text | YES |  |
| git_global_id | uuid | YES |  |
| primary_cli | text | YES | 'claude'::text |
| primary_model | text | YES |  |
| secondary_cli | text | YES |  |
| secondary_model | text | YES |  |
| create_quality_gate | boolean | YES | false |
| owner_uid | text | YES |  |
| conductor_files | jsonb | YES | '{}'::jsonb |
| created_at | timestamp without time zone | YES | now() |

## Table: track_comments

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | integer | NO | nextval('track_comments_id_seq'::regclass) |
| track_id | integer | YES |  |
| author | text | NO |  |
| body | text | NO |  |
| is_replied | boolean | YES | false |
| is_hidden | boolean | YES | false |
| created_at | timestamp without time zone | YES | now() |

## Table: project_members

| Column | Type | Nullable | Default |
|---|---|---|---|
| project_id | integer | NO |  |
| user_uid | text | NO |  |
| role | text | NO | 'member'::text |
| joined_at | timestamp with time zone | NO | now() |

## Table: users

| Column | Type | Nullable | Default |
|---|---|---|---|
| uid | text | NO |  |
| email | text | YES |  |
| display_name | text | YES |  |
| photo_url | text | YES |  |
| created_at | timestamp with time zone | NO | now() |
| last_login_at | timestamp with time zone | NO | now() |

## Table: workers

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | integer | NO | nextval('workers_id_seq'::regclass) |
| project_id | integer | YES |  |
| hostname | text | NO |  |
| pid | integer | NO |  |
| status | text | YES | 'idle'::text |
| current_task | text | YES |  |
| last_heartbeat | timestamp without time zone | YES | now() |
| created_at | timestamp without time zone | YES | now() |
| machine_token | text | YES |  |
| user_uid | text | YES |  |

## Table: tracks

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | integer | NO | nextval('tracks_id_seq'::regclass) |
| project_id | integer | YES |  |
| track_number | text | NO |  |
| title | text | NO |  |
| lane_status | text | YES | 'planning'::text |
| lane_action_status | text | YES | 'waiting'::text |
| lane_action_result | text | YES |  |
| progress_percent | integer | YES | 0 |
| current_phase | text | YES |  |
| phase_step | text | YES |  |
| content_summary | text | YES |  |
| index_content | text | YES |  |
| plan_content | text | YES |  |
| spec_content | text | YES |  |
| last_log_tail | text | YES |  |
| auto_planning_launched | timestamp without time zone | YES |  |
| auto_implement_launched | timestamp without time zone | YES |  |
| auto_review_launched | timestamp without time zone | YES |  |
| priority | integer | YES | 0 |
| sync_status | text | YES | 'synced'::text |
| last_updated_by | text | YES | 'worker'::text |
| last_heartbeat | timestamp without time zone | YES | now() |
| created_at | timestamp without time zone | YES | now() |
| last_updated_by_uid | text | YES |  |
| claimed_by | text | YES |  |
| active_cli | text | YES |  |

## Table: file_sync_queue

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | integer | NO | nextval('file_sync_queue_id_seq'::regclass) |
| project_id | integer | YES |  |
| file_path | text | NO |  |
| content | text | NO |  |
| status | character varying | YES | 'waiting'::character varying |
| worker_id | text | YES |  |
| error_message | text | YES |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |
| updated_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |

## Table: provider_status

| Column | Type | Nullable | Default |
|---|---|---|---|
| project_id | integer | NO |  |
| provider | text | NO |  |
| status | text | NO |  |
| reset_at | timestamp without time zone | YES |  |
| last_error | text | YES |  |
| updated_at | timestamp without time zone | YES | now() |

## Foreign Keys

| Table | Column | References | Foreign Column |
|---|---|---|---|
| tracks | project_id | projects | id |
| track_comments | track_id | tracks | id |
| workers | project_id | projects | id |
| project_members | project_id | projects | id |
| file_sync_queue | project_id | projects | id |
| provider_status | project_id | projects | id |

