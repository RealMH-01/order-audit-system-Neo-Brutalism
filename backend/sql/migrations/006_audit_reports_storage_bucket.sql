-- ============================================================
-- Supabase Storage: audit-reports bucket 创建备忘
-- ============================================================
--
-- Storage bucket 不能通过 SQL 创建。请在 Supabase Dashboard 操作：
--
-- 1. 进入 Supabase Dashboard → Storage
-- 2. 点击 "New bucket"
-- 3. 名称：audit-reports
-- 4. Public：关闭（私有 bucket）
-- 5. 文件大小限制：50MB
-- 6. Allowed MIME types：
--    application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
--    application/zip
--
-- Bucket 创建完成后，在 SQL Editor 中执行以下 RLS 策略：
-- ============================================================

-- 允许已登录用户读取自己路径下的报告
-- （路径格式：{user_id}/{task_id}/filename）
create policy "Users can read own audit reports"
on storage.objects for select
to authenticated
using (
  bucket_id = 'audit-reports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 后端使用 service_role_key 上传，service_role 默认绕过 RLS，无需额外策略。
