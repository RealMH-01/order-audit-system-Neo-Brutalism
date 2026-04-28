-- Task 1 migration for global system hard rules.

create extension if not exists pgcrypto;

create table if not exists public.system_hard_rules (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  content text not null,
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create table if not exists public.system_rule_change_logs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.system_hard_rules(id) on delete set null,
  rule_code_snapshot text not null,
  action text not null check (action in ('create', 'update', 'enable', 'disable', 'reorder', 'restore')),
  old_value jsonb,
  new_value jsonb,
  reason text not null check (length(btrim(reason)) > 0),
  summary text,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);

create or replace function public.set_system_hard_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_system_hard_rules_updated_at on public.system_hard_rules;
create trigger set_system_hard_rules_updated_at
before update on public.system_hard_rules
for each row execute function public.set_system_hard_rules_updated_at();

alter table public.system_hard_rules enable row level security;
alter table public.system_rule_change_logs enable row level security;

drop policy if exists "Authenticated users can select enabled system hard rules" on public.system_hard_rules;
create policy "Authenticated users can select enabled system hard rules"
on public.system_hard_rules
for select
to authenticated
using (is_enabled = true);

drop policy if exists "Admins can select all system hard rules" on public.system_hard_rules;
create policy "Admins can select all system hard rules"
on public.system_hard_rules
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admins can insert system hard rules" on public.system_hard_rules;
create policy "Admins can insert system hard rules"
on public.system_hard_rules
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admins can update system hard rules" on public.system_hard_rules;
create policy "Admins can update system hard rules"
on public.system_hard_rules
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admins can select system rule change logs" on public.system_rule_change_logs;
create policy "Admins can select system rule change logs"
on public.system_rule_change_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admins can insert system rule change logs" on public.system_rule_change_logs;
create policy "Admins can insert system rule change logs"
on public.system_rule_change_logs
for insert
to authenticated
with check (
  changed_by = auth.uid()
  and
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

insert into public.system_hard_rules (
  code,
  title,
  content,
  is_enabled,
  sort_order
) values
  (
    'evidence_only',
    '基于明确证据',
    '审核结论必须基于上传单据中的明确证据，不得猜测或编造。',
    true,
    10
  ),
  (
    'simplified_chinese',
    '简体中文输出',
    '用户可见输出必须使用简体中文。',
    true,
    20
  ),
  (
    'fixed_risk_levels',
    '固定风险等级',
    '风险等级必须固定为红色·高风险、黄色·疑点、蓝色·提示。',
    true,
    30
  ),
  (
    'merge_duplicates',
    '合并重复问题',
    '相同或高度重复的问题必须合并输出，避免重复刷屏。',
    true,
    40
  ),
  (
    'manual_review_when_unclear',
    '无法确认需复核',
    '无法确认的问题必须标记为需人工复核，不得直接下确定结论。',
    true,
    50
  ),
  (
    'no_pass_without_evidence',
    '缺少证据不默认通过',
    '不得因为缺少证据而默认判定为通过。',
    true,
    60
  ),
  (
    'priority_fields',
    '优先审核字段',
    '金额、数量、日期、主体、货品信息属于优先审核字段。',
    true,
    70
  ),
  (
    'stable_results',
    '审核结果稳定',
    '审核结果应尽量稳定，同一文件同一规则下不应大幅随机变化。',
    true,
    80
  ),
  (
    'fuzzy_id_matching',
    '编号模糊匹配与录入错误识别',
    $content$当目标单据缺少某个编号字段（如合同号、PO号）时，必须主动检查目标单据中其他编号字段（如发票号、PO号、提单号）是否与该缺失编号高度相似——即其余部分完全一致、仅差一位数字或多/少一个字符。如发现此类高度相似情况，应判定为RED·高风险，明确指出疑似录入错误或编号混用，说明具体差异（如'HR-EXP250401 疑似为 HR-EXP2504001 的录入错误，末尾缺少一位0'），而非简单报告为'该字段缺失'。注意：仅在其余部分完全一致且差异极小时才做此判定，避免将两个独立编号误判为录入错误。$content$,
    true,
    90
  ),
  (
    'invoice_no_equals_contract_no',
    '发票号与合同号相同属于正常业务惯例',
    $content$在部分业务场景中，Commercial Invoice（CI）和 Packing List（PL）上的发票号与 PO/合同中的合同号是同一个编号，这是允许且常见的业务惯例，不属于编号混用或录入错误。当目标单据的发票号与 PO 的合同号完全一致时，不应标记为风险问题。仅当发票号与合同号存在实际差异（如少字符、多字符、数字不同）时，才应按差异程度标记为 RED 或 YELLOW。$content$,
    true,
    100
  )
on conflict (code) do nothing;
