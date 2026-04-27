# Database Design Notes

## Scope

This callback aligns the Supabase data layer more closely to the original round-3 design:
- profiles
- industry_templates (legacy table retained for compatibility; no active product API)
- audit_history
- system_rules

`auth.users` remains managed by Supabase Auth and is not recreated here.

## Table Summary

### profiles

Purpose:
- user extension profile
- selected model and deep-think preference
- encrypted API key storage using the original field names
- company affiliate context
- custom rule ownership
- wizard / disclaimer state
- role

Key fields:
- `display_name`
- `selected_model`
- `deepseek_api_key`
- `zhipu_api_key`
- `zhipu_ocr_api_key`
- `openai_api_key`
- `deep_think_enabled`
- `company_affiliates`
- `company_affiliates_roles`
- `active_custom_rules`
- `wizard_completed`
- `disclaimer_accepted`
- `role`
- `created_at`
- `updated_at`

Implementation note:
- API key fields keep the original database names, but the stored values should be encrypted before write

### industry_templates (legacy)

Purpose:
- retained as an existing database table for compatibility only
- the legacy rules template product surface is offline
- active audit templates now live in `audit_templates` and are served by the `/templates` API

Key fields:
- `name`
- `description`
- `is_system`
- `user_id`
- `rules_text`
- `company_affiliates`

Design note:
- application bootstrap no longer seeds this table
- `/api/rules/templates` returns 410 Gone; it must not write to `profiles.active_custom_rules`

### audit_history

Purpose:
- store audit run summary and later detailed snapshots
- track persisted audit report locations in Supabase Storage

Key fields:
- `document_count`
- `red_count`
- `yellow_count`
- `blue_count`
- `audit_result`
- `model_used`
- `custom_rules_snapshot`
- `deep_think_used`
- `task_id` — opaque identifier of the audit task that produced this row; used to look up persisted reports
- `report_paths` — JSON object mapping report type to Storage object path, e.g. `{"marked": "reports/<user_id>/<task_id>/marked.xlsx", "detailed": "...", "zip": "..."}`. `null` when reports have not been persisted yet (in-memory fallback).

### system_rules

Purpose:
- store the default system-wide review rule text and internal prompt guidance

Key fields:
- `key`
- `display_text`
- `prompt_text`
- `updated_by`
- `updated_at`

## RLS Summary

### profiles
- user can select own row
- user can insert own row
- user can update own row
- custom rules stored in `active_custom_rules` therefore remain self-owned through profile ownership

### industry_templates
- legacy RLS policies remain part of the existing schema
- product code no longer exposes create/update/delete/load operations for this table

### audit_history
- users can only read and write their own history rows

### system_rules
- all authenticated users can read the full system rule content, including `prompt_text`
- only admin users can update system rules

## Initialization Logic

`backend/app/db/init_data.py` now provides idempotent bootstrap logic:

1. Check whether a `system_rules.key` already exists
2. Insert the default rule only when missing
3. Skip legacy `industry_templates` initialization

Repeated execution will skip existing records instead of duplicating them.

## Encryption Preparation

`backend/app/db/supabase_client.py` provides `ApiKeyCipher`:
- reads `ENCRYPTION_KEY`
- prepares Fernet-compatible encryption/decryption flow
- keeps the original database field names unchanged
- raises explicit Chinese errors if crypto dependency or key configuration is missing

Recommended usage:
- encrypt API key values before writing to `deepseek_api_key`, `zhipu_api_key`, `zhipu_ocr_api_key`, and `openai_api_key`
- decrypt only on the server side
- never return plaintext API keys to frontend clients

## Storage

### audit-reports bucket

Purpose:
- persist audit report artifacts produced by the audit pipeline so users can re-download them after the backend process restarts
- all reports are written by the backend using the Supabase service-role key; the bucket is private and the frontend never accesses Storage directly

Configuration:
- Bucket name: `audit-reports`
- Visibility: **private** (do not enable the public flag)
- Created manually via Supabase Dashboard → Storage → New bucket; see [deployment.md](./deployment.md#24-创建-storage-bucket)

Path layout:

```
reports/{user_id}/{task_id}/marked.xlsx
reports/{user_id}/{task_id}/detailed.xlsx
reports/{user_id}/{task_id}/reports.zip
```

- `{user_id}` matches `audit_history.user_id` (the Supabase auth user id)
- `{task_id}` matches `audit_history.task_id`
- The exact filenames `marked.xlsx`, `detailed.xlsx`, `reports.zip` are produced by `backend/app/services/audit_orchestrator.py` and consumed by the report download endpoints under `/api/audit/tasks/{task_id}/reports/...`

Access pattern:
- Backend uploads with the service-role key after the audit pipeline finishes
- Backend downloads with the service-role key when handling authenticated report download requests
- Frontend never receives signed URLs and never calls Supabase Storage directly; it always goes through the backend's report download endpoints, which enforce ownership against `audit_history.user_id`

This round does not introduce additional Storage RLS policies: privacy is enforced by keeping the bucket private and routing every read/write through the backend with the service-role key.

## Migrations

Migrations live under `backend/sql/migrations/` and must be applied manually in the Supabase SQL Editor.

### 001_auth_profiles_trigger.sql

- Purpose: install an `auth.users` insert trigger that auto-creates the matching `profiles` row, mirroring what `AuthService.register` does
- Acts as a safety net for users created from the Supabase Dashboard rather than the API
- Idempotent: re-runs are safe (uses `create or replace` and `drop trigger if exists`)

### 002_audit_report_paths.sql

- Purpose: add `task_id` (text) and `report_paths` (jsonb) columns to `audit_history` so that reports can be persisted in the `audit-reports` Storage bucket and re-downloaded later
- Required for any database that was bootstrapped before Round 9A
- Idempotent: uses `add column if not exists`, so it is safe to run on a fresh database where `supabase_schema.sql` already provides these columns, and it is safe to run multiple times

Recommended order for a fresh database:

1. `backend/sql/supabase_schema.sql`
2. `backend/sql/migrations/001_auth_profiles_trigger.sql`
3. `backend/sql/migrations/002_audit_report_paths.sql`

For an existing database deployed before Round 9A, only step 3 is strictly required (steps 1–2 are already applied).
