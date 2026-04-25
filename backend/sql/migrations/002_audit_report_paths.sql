-- Add report persistence metadata placeholders to audit history.
-- Round 9A-1 only stores nullable metadata fields; Storage upload follows later.

alter table public.audit_history
  add column if not exists task_id text;

alter table public.audit_history
  add column if not exists report_paths jsonb;
