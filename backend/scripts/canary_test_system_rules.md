# 系统硬规则金丝雀测试

## 本轮状态说明

本文件是生产环境手动验证操作手册。第 4 轮只完成本地测试和文档准备，不执行 Supabase SQL、不部署 ECS/Vercel、不做生产金丝雀。

请在第 1-4 轮 commit 统一 push、生产 Supabase 已执行 `backend/sql/migrations/008_seed_system_hard_rules_chinese.sql`、ECS 后端和 Vercel 前端均部署完成后，再执行下面步骤。

## 目的

在生产环境验证管理员修改的系统硬规则确实进入 LLM system prompt，并影响最新一次审核结果。

## 前置条件

1. 生产后端已部署并重启。
2. 生产前端已部署完成。
3. Supabase `system_hard_rules` 已有启用规则。
4. 管理员账号可以访问 `/admin/system-rules`。
5. 普通用户账号可以发起审核任务。

## 操作步骤

1. 以管理员身份登录生产前端。
2. 进入 `/admin/system-rules` 管理页面。
3. 找一条不太重要的规则，例如“输出格式约束”，点击编辑。
4. 在 `content` 末尾追加一句金丝雀文案：

   ```text
   （金丝雀测试 [当前日期]：如果你看到这句话，请在审核结果第一条 finding 的开头加上 🐤 符号。）
   ```

5. 保存规则。
6. 立即用普通用户账号发起一次审核任务，单据可任选一组可正常审核的测试单据。
7. 查看审核报告：
   - 第一条 finding 是否以 `🐤` 开头？
   - 是：修复成功，管理员修改的规则已经进入 LLM。
   - 否：修复失败，立即停止使用并排查。
8. 同时在 ECS 执行命令：

   ```bash
   journalctl -u order-audit-backend.service -n 50 | grep AUDIT_SYSTEM_PROMPT_LOADED
   ```

   预期：能看到本次审核加载的规则数量与 ID 列表，例如 `rule_count=12`、`rule_ids=[...]`、`rule_codes=[...]`。

## 恢复规则

金丝雀文案只用于临时验证，不要长期保留在生产规则中。

1. 回到 `/admin/system-rules`。
2. 打开刚才编辑的规则。
3. 删除追加的金丝雀文案。
4. 保存恢复后的规则。
5. 再用普通用户账号发起一次普通审核。
6. 确认新的审核结果中 `🐤` 不再出现。

## 数量一致性验证（独立执行）

### 操作步骤

1. 在管理员后台“系统硬规则”页面，数显示为“启用”状态的规则总数，记为 A。
   - 如有分页，必须翻完所有页累计数量。
   - 不要只数当前页。
2. 用浏览器 F12 打开 Network 面板，刷新管理员页面，找到 `GET /api/admin/system-rules` 的响应，数返回数组里 `is_enabled=true` 的对象个数，记为 B。
   - 如响应是分页或包装对象，必须确认总数或翻完所有页。
3. 发起一次审核任务，去服务器执行：

   ```bash
   journalctl -u order-audit-backend.service -n 100 | \
     grep AUDIT_SYSTEM_PROMPT_LOADED | tail -1
   ```

   日志里 `rule_count=X`，记为 C。

### 验收

A == B == C，三个数字必须完全相等。

### 排查指南

- A != B：前端显示有 bug，可能是分页或过滤逻辑问题，应排查前端。
- B != C：API 和 orchestrator 使用的查询条件不一致，应排查后端。
- A、B、C 都不一致：可能是数据库连接配置错乱，立即停止使用并排查。
