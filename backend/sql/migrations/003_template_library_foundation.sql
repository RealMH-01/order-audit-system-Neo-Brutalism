-- Round T1: backend template library foundation.
--
-- IMPORTANT:
--   * Execute this file manually in the Supabase SQL Editor.
--   * The application does not run migrations automatically.
--   * Pushing this repository alone does not make these tables available online.

create extension if not exists pgcrypto;

create table if not exists public.audit_rule_packages (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  description text,
  business_type text,
  package_type text not null,
  version integer not null default 1,
  rules jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint audit_rule_packages_business_type_check
    check (business_type is null or business_type in ('domestic', 'foreign')),
  constraint audit_rule_packages_package_type_check
    check (package_type in ('base_common', 'business'))
);

create table if not exists public.audit_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  business_type text not null,
  supplemental_rules text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint audit_templates_name_not_blank_check
    check (length(btrim(name)) > 0),
  constraint audit_templates_business_type_check
    check (business_type in ('domestic', 'foreign'))
);

create unique index if not exists audit_templates_one_default_per_user
on public.audit_templates (user_id)
where is_default = true;

drop trigger if exists audit_rule_packages_set_updated_at on public.audit_rule_packages;
create trigger audit_rule_packages_set_updated_at
before update on public.audit_rule_packages
for each row execute function public.set_updated_at();

drop trigger if exists audit_templates_set_updated_at on public.audit_templates;
create trigger audit_templates_set_updated_at
before update on public.audit_templates
for each row execute function public.set_updated_at();

alter table public.audit_rule_packages enable row level security;
alter table public.audit_templates enable row level security;

drop policy if exists audit_rule_packages_select_authenticated on public.audit_rule_packages;
create policy audit_rule_packages_select_authenticated
on public.audit_rule_packages
for select
to authenticated
using (is_active = true);

drop policy if exists audit_templates_select_own on public.audit_templates;
create policy audit_templates_select_own
on public.audit_templates
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists audit_templates_insert_own on public.audit_templates;
create policy audit_templates_insert_own
on public.audit_templates
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists audit_templates_update_own on public.audit_templates;
create policy audit_templates_update_own
on public.audit_templates
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists audit_templates_delete_own on public.audit_templates;
create policy audit_templates_delete_own
on public.audit_templates
for delete
to authenticated
using (user_id = auth.uid());

insert into public.audit_rule_packages (
  code,
  name,
  description,
  business_type,
  package_type,
  version,
  rules,
  is_active
) values
(
  'base_common_v1',
  '基础通用规则包',
  '所有单据审核默认启用，不区分内贸或外贸。',
  null,
  'base_common',
  1,
  jsonb_build_array(
    '金额是否一致',
    '数量是否一致',
    '日期逻辑是否合理',
    '买卖双方信息是否一致',
    '单据编号是否缺失',
    '商品名称、规格、单位是否冲突',
    '关键字段是否存在异常',
    '缺失字段、冲突字段、异常字段要提示人工复核'
  ),
  true
),
(
  'domestic_v1',
  '内贸规则包',
  '适用于国内订单、国内合同、增值税发票、送货单、对账单、采购单、销售单。',
  'domestic',
  'business',
  1,
  jsonb_build_array(
    '公司名称',
    '统一社会信用代码',
    '开票信息',
    '含税金额、未税金额、税率、税额',
    '送货数量、签收数量、开票数量',
    '付款条件、账期、结算方式',
    '收货地址、联系人、电话'
  ),
  true
),
(
  'foreign_v1',
  '外贸规则包',
  '适用于 PO、PI、Commercial Invoice、Packing List、B/L、出口合同、报关资料。',
  'foreign',
  'business',
  1,
  jsonb_build_array(
    'Buyer / Seller / Consignee / Notify Party',
    'Incoterms',
    '目的港、装运港、交货期',
    '币种、金额、数量、单价',
    '箱数、毛重、净重、体积',
    '英文品名、规格、型号、HS Code',
    '外贸付款方式、信用证、唛头、运输方式'
  ),
  true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  business_type = excluded.business_type,
  package_type = excluded.package_type,
  version = excluded.version,
  rules = excluded.rules,
  is_active = excluded.is_active,
  updated_at = now();
