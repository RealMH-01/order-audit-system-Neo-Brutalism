# 修复验收清单

## 状态边界

第 4 轮只做本地验证、自动化测试、金丝雀操作手册和验收清单，不执行生产 Supabase SQL，不部署 ECS/Vercel，不声称生产端到端验证已完成。

## 推荐人工执行顺序

1. 本地第 4 轮测试通过。
   - 命令：
     ```bash
     cd backend
     python -m compileall app tests
     python -m pytest tests/services/test_audit_engine_rules.py -q
     ```
2. 第 4 轮本地 commit。
   - 命令：
     ```bash
     git status --short
     git add backend/tests/services/test_audit_engine_rules.py backend/scripts/canary_test_system_rules.md backend/docs/fix_verification_checklist.md README.md
     git commit -m "fix(rules): 添加系统规则验证清单"
     ```
3. 统一 push 第 1-4 轮 commit。
   - 命令：
     ```bash
     git push origin <your-branch>
     ```
4. 在 Supabase SQL Editor 人工执行 `backend/sql/migrations/008_seed_system_hard_rules_chinese.sql`。
   - 操作：打开 Supabase SQL Editor，粘贴完整 SQL，点击 Run，确认无错误。
5. 在 `/admin/system-rules` 人工复核既有 code 冲突的 5 条规则。
   - 操作：逐条搜索并确认 title/content/is_enabled/sort_order 是否符合预期：
     - `evidence_only`
     - `simplified_chinese`
     - `fixed_risk_levels`
     - `merge_duplicates`
     - `stable_results`
6. 部署 ECS 后端。
   - 命令：
     ```bash
     ssh root@8.136.189.224
     cd /opt/order-audit-system-Neo-Brutalism
     git pull origin main
     sudo systemctl restart order-audit-backend.service
     sudo systemctl status order-audit-backend.service --no-pager
     ```
7. 等待 Vercel 前端自动部署。
   - 操作：打开 Vercel 项目 Deployments 页面，确认最新 commit 部署成功。
8. 打开生产前端验收，访问 Vercel 时记得开启 VPN/加速器。
   - 操作：访问生产域名，登录管理员账号，进入 `/admin/system-rules`。
9. 验证 `PUT /api/rules/builtin` 返回 410。
   - 命令：
     ```bash
     curl -i -X PUT https://<your-domain>/api/rules/builtin
     ```
   - 预期：HTTP 410，返回中文错误信息。
10. 验证 `GET /api/rules/builtin` 与管理员后台启用规则一致。
    - 命令：
      ```bash
      curl -s https://<your-domain>/api/rules/builtin
      ```
    - 操作：对照 `/admin/system-rules` 中启用规则的 title/content/sort_order。
11. 执行金丝雀测试。
    - 操作：按 `backend/scripts/canary_test_system_rules.md` 完整执行，并在结束后恢复规则。
12. 执行 A/B/C 数量一致性验证。
    - 操作：按本文“数量一致性验证”执行。
13. 验证 ECS 日志中有 `AUDIT_SYSTEM_PROMPT_LOADED`。
    - 命令：
      ```bash
      journalctl -u order-audit-backend.service -n 100 | grep AUDIT_SYSTEM_PROMPT_LOADED
      ```
    - 预期：每次审核任务都有一条对应日志。

## 代码层验证

- [ ] 业务代码无 `_SYSTEM_PROMPT` 残留。
      命令：
      ```bash
      rg "_SYSTEM_PROMPT|SYSTEM_PROMPT_TEXT" backend/app frontend
      ```
      预期：0 命中。

- [ ] `system_hard_rules` 表中至少有 N 条启用规则。
      N 的判断说明：`008_seed_system_hard_rules_chinese.sql` 当前定义 20 条种子规则；其中 5 条可能与既有 code 冲突并被 `ON CONFLICT DO NOTHING` 跳过。实际启用数量以 Supabase 表中 `is_enabled=true` 的记录数为准。执行 SQL 后，应重点确认新增种子规则和既有规则共同组成当前启用规则集。
      命令：
      ```sql
      select count(*) from public.system_hard_rules where is_enabled = true;
      ```
      预期：结果 >= 12，并且包含用户已有启用规则。

- [ ] `PUT /api/rules/builtin` 返回 410。
      命令：
      ```bash
      curl -i -X PUT https://<your-domain>/api/rules/builtin
      ```
      预期：HTTP 410，中文错误信息。

- [ ] `GET /api/rules/builtin` 返回内容与管理后台启用规则一致。
      命令：
      ```bash
      curl -s https://<your-domain>/api/rules/builtin
      ```
      操作：对照 `/admin/system-rules` 页面中所有启用规则，确认 title/content/sort_order 一致。

- [ ] `system_rules_admin.py` docstring 已更新。
      命令：
      ```bash
      grep -n "intentionally" backend/app/services/system_rules_admin.py
      ```
      预期：0 命中。

- [ ] 前端管理界面有“修改立即生效”提示横幅。
      操作：登录管理员账号，进入 `/admin/system-rules`，确认页面可见“修改立即生效”提示。

## 运行时验证

- [ ] 自动化测试：本轮新增测试全部通过。
      命令：
      ```bash
      cd backend
      python -m pytest tests/services/test_audit_engine_rules.py -q
      ```
      预期：全部通过。

- [ ] 金丝雀测试：`🐤` 符号确实出现在审核结果中。
      操作：按 `backend/scripts/canary_test_system_rules.md` 执行，第一条 finding 以 `🐤` 开头即通过。

- [ ] 金丝雀恢复验证：删除金丝雀文案后，`🐤` 不再出现在审核结果中。
      操作：恢复原规则后再次发起普通审核，确认新的审核报告没有 `🐤`。

- [ ] 日志验证：`AUDIT_SYSTEM_PROMPT_LOADED` 条目存在。
      命令：
      ```bash
      journalctl -u order-audit-backend.service -n 100 | grep AUDIT_SYSTEM_PROMPT_LOADED
      ```
      预期：每次审核任务都有一条对应日志。

## 数量一致性验证（防 PTSD 加强项）

- [ ] A == B == C。
      A：管理员后台显示的启用规则数，必须翻完所有页累计。
      B：`GET /api/admin/system-rules` 响应中 `is_enabled=true` 数量。
      C：日志中 `AUDIT_SYSTEM_PROMPT_LOADED` 的 `rule_count`。
      操作：
      1. 在管理员后台数启用规则数量，记为 A。
      2. 浏览器 F12 打开 Network，刷新 `/admin/system-rules`，检查 `GET /api/admin/system-rules`，统计 `is_enabled=true` 数量，记为 B。
      3. 发起一次审核，在 ECS 执行：
         ```bash
         journalctl -u order-audit-backend.service -n 100 | grep AUDIT_SYSTEM_PROMPT_LOADED | tail -1
         ```
         读取 `rule_count`，记为 C。
      预期：A、B、C 三个数字完全相等。
