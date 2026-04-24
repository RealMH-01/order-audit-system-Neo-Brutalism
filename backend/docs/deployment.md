# 部署指南

## 一、环境要求

- Python 3.11 或更高版本
- Node.js 18 或更高版本
- 一个 Supabase 项目（免费套餐即可）
- 至少一个 LLM API Key（OpenAI / DeepSeek / 智谱，三选一即可）

## 二、Supabase 配置

### 2.1 创建项目

在 <https://supabase.com> 创建一个新项目，记录以下信息：

- Project URL（即 `SUPABASE_URL`）
- anon public key（即 `SUPABASE_ANON_KEY`）
- service_role secret key（即 `SUPABASE_SERVICE_ROLE_KEY`）

### 2.2 关闭邮件确认

进入 Authentication - Providers - Email，将 Confirm email 开关关闭。

如果不关闭，用户注册后不会立即获得 `access_token`，会导致注册流程返回 422 或 429 错误。

### 2.3 执行数据库脚本

在 Supabase Dashboard 的 SQL Editor 中，按顺序执行：

1. `backend/sql/supabase_schema.sql`

   该脚本会创建以下表和 RLS 策略：

   - `profiles`：用户扩展资料（模型配置、API Key、公司架构、自定义规则、角色）
   - `industry_templates`：行业模板（系统模板 + 用户模板）
   - `audit_history`：审核历史记录
   - `system_rules`：系统内置审核规则

2. `backend/sql/migrations/001_auth_profiles_trigger.sql`（可选）

   该脚本创建一个触发器，当通过 Supabase Dashboard 手动创建用户时，自动在 `profiles` 表中插入对应记录。后端代码中 `AuthService.register` 已经会自动创建 profile，所以这个触发器只是一层安全网。

### 2.4 生成加密密钥

API Key 在数据库中使用 Fernet 加密存储，需要生成一个 `ENCRYPTION_KEY`：

```python
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
```

将生成的字符串填入后端 `.env` 的 `ENCRYPTION_KEY`。

## 三、后端部署（Render）

### 3.1 环境变量

在 Render Dashboard 中设置以下环境变量：

必填：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY`

LLM 相关（至少填一组）：

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `ZHIPUAI_API_KEY`

可选：

- `APP_ENV=production`
- `DEBUG=false`
- `ALLOWED_ORIGINS=https://你的前端域名`
- `DEFAULT_LLM_PROVIDER=openai`（或 `deepseek`、`zhipuai`）
- `DEFAULT_TEXT_MODEL=gpt-4o`（或 `deepseek-v4-flash`、`glm-4-flash`）

### 3.2 部署配置

项目已包含 `backend/render.yaml`，Render 可直接识别。主要配置：

- 构建命令：`pip install -r requirements.txt`
- 启动命令：`uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Python 版本：3.11
- 系统依赖：`packages.txt` 中列出了 `poppler-utils` 等系统包

### 3.3 注意事项

- 当前审核报告存储在进程内存中，Render 重启后报告会丢失。这是已知限制，生产环境建议后续接入 Supabase Storage。
- 确保 `ALLOWED_ORIGINS` 包含前端实际部署的域名，否则会出现 CORS 错误。

## 四、前端部署（Vercel）

### 4.1 环境变量

在 Vercel Dashboard 中设置：

- `NEXT_PUBLIC_API_BASE_URL=https://你的后端域名/api`

### 4.2 部署配置

Vercel 会自动检测 Next.js 项目，无需额外配置。确保：

- 根目录设置为 `frontend`
- 构建命令：`npm run build`
- 输出目录：`.next`

## 五、部署后验证

部署完成后，按以下顺序验证：

1. 访问后端 `/api/health`，确认返回 200
2. 在前端注册一个用户，确认注册成功并获得 token
3. 进入设置页，选择一个模型提供商，输入 API Key，点击测试连接
4. 进入审核工作台，上传 PO 和待审核文件，启动一次审核
5. 审核完成后，点击下载报告，确认 Excel 和 ZIP 文件可正常打开
