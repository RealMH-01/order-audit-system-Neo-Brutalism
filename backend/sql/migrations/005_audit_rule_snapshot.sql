-- Round T4: persist per-run audit rule snapshots and clarify HS Code wording.
--
-- IMPORTANT:
--   * Execute this file manually in the Supabase SQL Editor.
--   * The application does not run migrations automatically.
--   * This migration intentionally does not modify 003_template_library_foundation.sql
--     or 004_update_rule_package_action_wording.sql.

alter table public.audit_history
  add column if not exists audit_rule_snapshot jsonb;

update public.audit_rule_packages
set
  rules = jsonb_build_array(
    '核对 Buyer、Seller、Consignee、Notify Party 在 PO、PI、Invoice、Packing List、B/L 中是否一致。',
    '核对 Incoterms、装运港、目的港、运输方式是否前后一致。',
    '核对交货期、装运期、开票日期、提单日期之间的时间逻辑是否合理。',
    '核对币种、单价、数量、总金额是否一致，计算关系是否正确。',
    '核对箱数、毛重、净重、体积是否在发票、箱单、提单中一致。',
    '核对英文品名、规格、型号等货品信息是否一致；如涉及 HS Code / 海关编码，应检查其是否缺失、冲突或前后不一致。',
    '核对付款方式、信用证条款、唛头信息是否与订单或合同要求一致。',
    '发现单据主体、金额、数量、港口、贸易条款或运输信息冲突时，标记为需人工复核。'
  ),
  updated_at = now()
where code = 'foreign_v1';
