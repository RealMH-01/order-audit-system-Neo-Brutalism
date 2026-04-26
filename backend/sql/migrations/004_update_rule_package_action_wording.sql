-- Round T3: improve domestic / foreign rule package wording.
--
-- IMPORTANT:
--   * Execute this file manually in the Supabase SQL Editor.
--   * The application does not run migrations automatically.
--   * This migration intentionally does not modify 003_template_library_foundation.sql.

update public.audit_rule_packages
set
  rules = jsonb_build_array(
    '核对订单、合同、发票、送货单、对账单中的公司名称是否一致。',
    '核对统一社会信用代码、纳税人识别号、开票抬头是否缺失或冲突。',
    '核对开票信息中的开户行、账号、地址、电话是否完整且前后一致。',
    '核对含税金额、未税金额、税率、税额之间的计算关系是否合理。',
    '核对订单数量、送货数量、签收数量、开票数量是否一致；不一致时标记差异。',
    '核对付款条件、账期、结算方式是否与合同或订单约定一致。',
    '核对收货地址、联系人、电话是否完整，且与送货单或订单一致。',
    '发现字段缺失、金额不一致、主体不一致或数量不一致时，标记为需人工复核。'
  ),
  updated_at = now()
where code = 'domestic_v1';

update public.audit_rule_packages
set
  rules = jsonb_build_array(
    '核对 Buyer、Seller、Consignee、Notify Party 在 PO、PI、Invoice、Packing List、B/L 中是否一致。',
    '核对 Incoterms、装运港、目的港、运输方式是否前后一致。',
    '核对交货期、装运期、开票日期、提单日期之间的时间逻辑是否合理。',
    '核对币种、单价、数量、总金额是否一致，计算关系是否正确。',
    '核对箱数、毛重、净重、体积是否在发票、箱单、提单中一致。',
    '核对英文品名、规格、型号、HS Code 是否缺失、冲突或前后不一致。',
    '核对付款方式、信用证条款、唛头信息是否与订单或合同要求一致。',
    '发现单据主体、金额、数量、港口、贸易条款或运输信息冲突时，标记为需人工复核。'
  ),
  updated_at = now()
where code = 'foreign_v1';
