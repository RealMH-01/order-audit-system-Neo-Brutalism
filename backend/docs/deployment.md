# 部署指南

本文件描述外贸单据智能审核系统的生产部署流程。系统由三部分组成：

- **后端**：FastAPI（部署到 Render）
- **前端**：Next.js 14（部署到 Vercel）
- **数据层**：Supabase（PostgreSQL + Auth + Storage）

如果只需要一份按步骤勾选的速查清单，请直接看 [部署检查清单](../../docs/deploy-checklist.md)。

## 一、环境要求

- Python 3.11 或更高版本
- Node.js 18 或更高版本
- 一个 Supabase 项目（免费套餐即可）
- 至少一个 LLM API Key（OpenAI / DeepSeek / 智谱，三选一即可）
- GitHub 账号（Render 与 Vercel 都通过 GitHub 仓库导入）

## 二、Supabase 配置

### 2.1 创建项目

在 <https://supabase.com> 创建一个新项目，记录以下三个值（部署后端时会用到）：

- **Project URL** → 用作 `SUPABASE_URL`
- **anon public key** → 用作 `SUPABASE_ANON_KEY`
- **service_role secret key** → 用作 `SUPABASE_SERVICE_ROLE_KEY`（只在后端使用，绝不可暴露到前端）

### 2.2 关闭邮件确认

进入 **Authentication → Providers → Email**，将 **Confirm email** 开关关闭。

如果不关闭，用户注册后不会立即获得 `access_token`，会导致注册流程返回 422 或 429 错误。

### 2.3 执行数据库脚本

在 Supabase Dashboard 的 SQL Editor 中按顺序执行以下脚本。

**全新数据库（推荐顺序）：**

1. `backend/sql/supabase_schema.sql`

   该脚本会创建以下表、触发器和 RLS 策略：

   - `profiles`：用户扩展资料（模型配置、加密 API Key、公司架构、自定义规则、角色）
   - `industry_templates`：行业模板（系统模板 + 用户模板）
   - `audit_history`：审核历史记录（已包含 `task_id` 与 `report_paths` 两个字段）
   - `system_rules`：系统内置审核规则

2. `backend/sql/migrations/001_auth_profiles_trigger.sql`

   创建 `auth.users` 插入触发器，当通过 Supabase Dashboard 手动添加用户时自动写入对应的 `profiles` 行。后端 `AuthService.register` 已经会自行 upsert profile，这里只是一层安全网，但仍然建议执行。

3. `backend/sql/migrations/002_audit_report_paths.sql`

   为 `audit_history` 补齐 `task_id` 和 `report_paths` 两个字段，用于审核报告在 Storage 中的持久化路径。
   该脚本使用 `add column if not exists`，对已经包含这两列的 fresh DB 执行也完全安全。

**已有旧数据库（在 Round 9A 之前已经部署过的项目）：**

只需追加执行：

```text
backend/sql/migrations/002_audit_report_paths.sql
```

该 migration 是幂等的，重复执行不会产生副作用，因此即便不确定历史是否已应用，也可以再跑一次。

### 2.4 创建 Storage Bucket

进入 **Storage → New bucket**，按以下配置创建：

- **Name**：`audit-reports`
- **Public bucket**：**关闭（保持 private）**

报告内容包含审核结果，必须使用 private bucket。前端不会直连 Storage，所有下载都通过后端鉴权接口完成（详见 [database.md](./database.md) 中的 Storage 章节）。

### 2.5 生成加密密钥

API Key 在数据库中使用 Fernet 加密存储，需要生成一个 `ENCRYPTION_KEY`：

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

将输出的字符串作为 `ENCRYPTION_KEY` 配置到后端环境变量。**生产环境务必使用一份新生成的密钥**，不要直接复用 `.env.example` 中的示例值。

> 如果之后修改了 `ENCRYPTION_KEY`，所有已加密入库的 LLM API Key 将无法解密，用户需要重新在设置页录入。

## 三、后端部署（Render）

仓库内已包含 `backend/render.yaml` 与 `backend/Dockerfile`，因此 Render 提供两种部署方式，按需选择其一即可。

### 3.1 方案 A：Render Blueprint 部署（推荐）

`backend/render.yaml` 已经声明了服务定义（Python 环境、构建命令、启动命令等），可以直接通过 Blueprint 一键创建服务。

步骤：

1. 进入 <https://dashboard.render.com> → **New → Blueprint**。
2. 选择本项目的 GitHub 仓库。
3. Render 会自动读取 `backend/render.yaml` 并创建名为 `order-audit-system-backend` 的 Web Service。
4. 在创建过程中或服务详情的 **Environment** 选项卡中补齐 [3.3 节](#33-环境变量完整清单) 列出的环境变量。
5. 触发首次部署，等待构建完成。

> Blueprint 模式下 `rootDir`、Build Command、Start Command、Python 运行时均由 `render.yaml` 控制，无需手动填写。

### 3.2 方案 B：手动创建 Web Service

如果不使用 Blueprint，也可以手动创建：

1. 进入 **New → Web Service**，选择本仓库。
2. **Root Directory**：填 `backend`
3. **Environment**：`Python 3`（项目要求 Python 3.11，可在服务设置中固定 runtime）
4. **Build Command**：`pip install -r requirements.txt`
5. **Start Command**：`uvicorn app.main:app --host 0.0.0.0 --port $PORT`
6. **Plan**：可先选 Free，按需升级。
7. 在 **Environment** 中补齐 [3.3 节](#33-环境变量完整清单) 列出的所有变量。
8. 保存后触发首次部署。

> 后端镜像也提供 `backend/Dockerfile`（基于 `python:3.11-slim`，预装 `poppler-utils` 等系统依赖），如果改用 Render 的 Docker 部署模式，可直接复用。Dockerfile 中默认监听 8000 端口，使用时仍然需要设置上述环境变量。

### 3.3 环境变量完整清单

下表与 `backend/.env.example` 完全对齐。请按是否必填配置到 Render 的 Environment 选项卡。

| 变量名 | 必填 | 用途 | 示例值（不含真实密钥） |
| --- | --- | --- | --- |
| `APP_ENV` | 否 | 运行环境标识，生产建议设为 `production` | `production` |
| `APP_NAME` | 否 | 应用名称，仅用于展示 | `Order Audit System API` |
| `APP_VERSION` | 否 | 应用版本号 | `0.1.0` |
| `API_V1_PREFIX` | 否 | API 路径前缀，默认 `/api`，前端 `NEXT_PUBLIC_API_BASE_URL` 末尾必须与之一致 | `/api` |
| `DEBUG` | 否 | 调试开关，生产环境必须为 `false` | `false` |
| `ALLOWED_ORIGINS` | **是** | CORS 允许的来源，必须是 JSON 数组字符串，**生产环境改为 Vercel 真实域名**，不能保留 `localhost` | `["https://your-app.vercel.app"]` |
| `SUPABASE_URL` | **是** | Supabase 项目 URL | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **是** | Supabase service_role 密钥（后端专用，禁止下发前端） | `eyJhbGciOi...`（占位） |
| `SUPABASE_ANON_KEY` | **是** | Supabase anon key | `eyJhbGciOi...`（占位） |
| `ENCRYPTION_KEY` | **是** | Fernet 密钥，加密用户 LLM API Key，使用 [2.5](#25-生成加密密钥) 中的命令生成 | `（用 Fernet.generate_key 生成的 44 位字符串）` |
| `OPENAI_API_KEY` | 见下 | OpenAI API Key | `sk-...`（占位） |
| `OPENAI_BASE_URL` | 否 | OpenAI 自定义 Base URL（用代理时填） | `https://api.openai.com/v1` |
| `DEEPSEEK_API_KEY` | 见下 | DeepSeek API Key | `sk-...`（占位） |
| `DEEPSEEK_BASE_URL` | 否 | DeepSeek Base URL，默认即可 | `https://api.deepseek.com` |
| `ZHIPUAI_API_KEY` | 见下 | 智谱 GLM API Key | `（占位）` |
| `DEFAULT_LLM_PROVIDER` | 否 | 用户未配置时使用的默认提供商 | `openai` / `deepseek` / `zhipuai` |
| `DEFAULT_TEXT_MODEL` | 否 | 默认文本模型 | `gpt-4o` / `deepseek-v4-flash` / `glm-4-flash` |
| `DEFAULT_REASONING_MODEL` | 否 | 默认深度推理模型 | `o3-mini` / `deepseek-v4-pro` |
| `DEFAULT_VISION_MODEL` | 否 | 默认视觉/OCR 模型 | `gpt-4o` / `glm-4v` |

**LLM API Key 规则**：`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`ZHIPUAI_API_KEY` 三者中**至少配置一组**。系统也允许用户在前端设置页面录入自己的 Key（同样会用 `ENCRYPTION_KEY` 加密入库），后端环境变量仅作为兜底默认值。

**生产环境注意事项**：

- `ALLOWED_ORIGINS` 必须包含 Vercel 实际部署的域名（含协议头），否则前端调用 API 会触发 CORS 错误。如果使用 Vercel preview 部署，需要把 preview 域名也加进数组。
- `DEBUG=false`、`APP_ENV=production` 仅影响日志和错误栈展示，不影响功能。
- `ENCRYPTION_KEY` 一旦设置就不要再换，否则之前加密入库的 API Key 全部失效。

### 3.4 部署后健康检查

部署完成后，访问 `https://<render-service>.onrender.com/api/health`，应返回 `200`。Render 服务首次冷启动可能需要数十秒。

## 四、前端部署（Vercel）

### 4.1 部署步骤

1. 进入 <https://vercel.com> → **Add New → Project**。
2. 选择本项目的 GitHub 仓库。
3. **Root Directory**：填 `frontend`
4. **Framework Preset**：`Next.js`（Vercel 会自动识别）
5. Build Command 和 Output Directory 保持默认即可（`next build` / `.next`）。
6. 在 **Environment Variables** 中配置 [4.2 节](#42-环境变量) 列出的变量。
7. 点击 Deploy，等待构建完成。
8. 部署成功后记下 Vercel 分配的域名（形如 `https://your-app.vercel.app`），把它加到后端的 `ALLOWED_ORIGINS` 中。

### 4.2 环境变量

下表与 `frontend/.env.example` 完全对齐。

| 变量名 | 必填 | 用途 | 示例值 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | **是** | Render 后端的 API 根路径，**必须以 `/api` 结尾** | `https://order-audit-system-backend.onrender.com/api` |
| `NEXT_PUBLIC_APP_NAME` | 否 | 前端展示用的应用名 | `Order Audit System` |

> `NEXT_PUBLIC_API_BASE_URL` 末尾的 `/api` 必须与后端 `API_V1_PREFIX` 保持一致。如果后端改了前缀，前端这里也要同步。

### 4.3 CORS 联调

后端 `ALLOWED_ORIGINS` 必须包含本前端的 Vercel 域名。常见配法：

```text
ALLOWED_ORIGINS=["https://your-app.vercel.app"]
```

如同时启用 Vercel preview 部署，可加入对应 preview 域名：

```text
ALLOWED_ORIGINS=["https://your-app.vercel.app","https://your-app-git-feature-xxx.vercel.app"]
```

修改后端 `ALLOWED_ORIGINS` 之后需要重新部署 Render 服务才会生效。

## 五、部署后端到端验证

按以下顺序在生产环境跑一次全链路：

1. 访问后端 `/api/health`，确认返回 200。
2. 访问前端首页，确认页面正常加载。
3. 注册一个用户，登录后进入设置页。
4. 选择一个模型提供商，输入 API Key，点击「测试连接」，确认返回成功。
5. 进入审核工作台，上传 PO 与待审核文件，启动一次审核。
6. 审核完成后查看结果，并依次下载「标记版 Excel」「详情版 Excel」「ZIP 报告包」，确认文件可正常打开。
7. 在 Supabase Dashboard 的 Storage `audit-reports` bucket 内能看到 `reports/{user_id}/{task_id}/` 路径下的三个文件。

如果任意一步失败，参考根目录 [部署检查清单](../../docs/deploy-checklist.md) 重新核对环境变量、Supabase schema 与 CORS 配置。
