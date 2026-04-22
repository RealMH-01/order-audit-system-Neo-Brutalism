# Database Design Notes

## Scope

This callback aligns the Supabase data layer more closely to the original round-3 design:
- profiles
- industry_templates
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

### industry_templates

Purpose:
- store both system templates and user-defined templates

Key fields:
- `name`
- `description`
- `is_system`
- `user_id`
- `rules_text`
- `company_affiliates`

Design note:
- system templates use `is_system=true` and `user_id=null`
- user templates use `is_system=false` and `user_id=auth.uid()`

### audit_history

Purpose:
- store audit run summary and later detailed snapshots

Key fields:
- `document_count`
- `red_count`
- `yellow_count`
- `blue_count`
- `audit_result`
- `model_used`
- `custom_rules_snapshot`
- `deep_think_used`

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
- all authenticated users can read system templates
- users can read/write/delete only their own non-system templates
- admins may maintain system templates
- admins do not automatically gain write access to other users' non-system templates

### audit_history
- users can only read and write their own history rows

### system_rules
- all authenticated users can read the full system rule content, including `prompt_text`
- only admin users can update system rules

## Initialization Logic

`backend/app/db/init_data.py` now provides idempotent bootstrap logic:

1. Check whether a `system_rules.key` already exists
2. Insert the default rule only when missing
3. Check whether a system template already exists by matching:
   - `is_system=true`
   - `rules_text`
   - `company_affiliates`
4. Insert missing system templates only once

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
