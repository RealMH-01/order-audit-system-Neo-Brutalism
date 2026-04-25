# 部署检查清单

面向部署者的逐项核对清单。完整说明见 [backend/docs/deployment.md](../backend/docs/deployment.md)。

## Supabase

- [ ] 创建 Supabase 项目
- [ ] 在 SQL Editor 中执行 `backend/sql/supabase_schema.sql`
- [ ] 在 SQL Editor 中执行 `backend/sql/migrations/001_auth_profiles_trigger.sql`
- [ ] 在 SQL Editor 中执行 `backend/sql/migrations/002_audit_report_paths.sql`（幂等，旧库补齐 `task_id` / `report_paths`，新库重复执行也安全）
- [ ] 关闭 Authentication → Providers → Email → Confirm email
- [ ] 在 Storage 中创建 bucket：`audit-reports`，**保持 private（不要勾选 public）**
- [ ] 记录 `SUPABASE_URL`
- [ ] 记录 `SUPABASE_ANON_KEY`
- [ ] 记录 `SUPABASE_SERVICE_ROLE_KEY`（仅用于后端，禁止下发前端）

## 后端 (Render)

- [ ] 从 GitHub 导入仓库
  - Blueprint 模式：选择 `backend/render.yaml`，自动创建 `order-audit-system-backend` 服务
  - 或手动 Web Service 模式：Root Directory 填 `backend`
- [ ] （手动模式）Build Command：`pip install -r requirements.txt`
- [ ] （手动模式）Start Command：`uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- [ ] 配置环境变量 `SUPABASE_URL`
- [ ] 配置环境变量 `SUPABASE_ANON_KEY`
- [ ] 配置环境变量 `SUPABASE_SERVICE_ROLE_KEY`
- [ ] 配置环境变量 `ENCRYPTION_KEY`（用 `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` 生成，生产请使用全新值）
- [ ] 至少配置一组 LLM API Key：`OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `ZHIPUAI_API_KEY`
- [ ] 配置环境变量 `ALLOWED_ORIGINS`，JSON 数组形式，包含 Vercel 实际域名（如 `["https://your-app.vercel.app"]`）
- [ ] 配置环境变量 `APP_ENV=production`
- [ ] 配置环境变量 `DEBUG=false`
- [ ] （可选）配置 `DEFAULT_LLM_PROVIDER` / `DEFAULT_TEXT_MODEL` / `DEFAULT_REASONING_MODEL` / `DEFAULT_VISION_MODEL`
- [ ] （可选）配置 `OPENAI_BASE_URL` / `DEEPSEEK_BASE_URL`（仅在使用代理或非默认网关时需要）
- [ ] 部署成功后访问 `https://<render-service>.onrender.com/api/health`，确认返回 200

## 前端 (Vercel)

- [ ] 从 GitHub 导入仓库，Root Directory 填 `frontend`
- [ ] Framework Preset：Next.js
- [ ] 配置环境变量 `NEXT_PUBLIC_API_BASE_URL`，值为 Render 后端 URL **加 `/api` 后缀**（如 `https://order-audit-system-backend.onrender.com/api`）
- [ ] （可选）配置环境变量 `NEXT_PUBLIC_APP_NAME`
- [ ] 部署成功后获得 Vercel 域名，回到 Render 把它加入 `ALLOWED_ORIGINS` 并重新部署后端
- [ ] 访问首页，确认加载正常
- [ ] 测试注册 / 登录流程
- [ ] 测试完整审核流程：上传 PO + 待审核文件 → 启动审核 → 查看结果 → 下载标记版 Excel / 详情版 Excel / ZIP 报告
- [ ] 在 Supabase Dashboard → Storage → `audit-reports` 中能看到 `reports/{user_id}/{task_id}/` 下的报告文件
