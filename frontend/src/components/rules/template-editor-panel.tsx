import { AlertCircle, Loader2, Save, Trash2 } from "lucide-react";

import type { RulesRole, TemplateDraft, TemplateItem, TemplateMode } from "@/components/rules/types";
import {
  canDeleteTemplate,
  formatRulesDate,
  resolveTemplateScopeLabel
} from "@/components/rules/rules-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type TemplateEditorPanelProps = {
  role: RulesRole | null;
  currentUserId: string | null;
  mode: TemplateMode;
  template: TemplateItem | null;
  draft: TemplateDraft;
  saving: boolean;
  deleting: boolean;
  mutationError: string | null;
  onChange: (next: TemplateDraft) => void;
  onSave: () => void;
  onDelete: () => void;
  onReset: () => void;
};

export function TemplateEditorPanel({
  role,
  currentUserId,
  mode,
  template,
  draft,
  saving,
  deleting,
  mutationError,
  onChange,
  onSave,
  onDelete,
  onReset
}: TemplateEditorPanelProps) {
  const readOnly = mode === "view";
  const canDelete = template ? canDeleteTemplate(template, role, currentUserId) : false;

  return (
    <Card className="bg-paper">
      <CardHeader>
        <Badge variant="accent">
          {mode === "create" ? "新建模板" : mode === "edit" ? "编辑模板" : "查看模板"}
        </Badge>
        <CardTitle>
          {mode === "create"
            ? "创建用户模板"
            : mode === "edit"
              ? "维护模板内容"
              : "模板只读查看"}
        </CardTitle>
        <CardDescription>
          这里接上模板的创建、编辑和删除接口。本轮重点保证“用户模板”完整维护，同时按后端真实权限边界决定系统模板是否可改。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mutationError ? (
          <div className="issue-red p-4">
            <p className="flex items-center gap-2 text-sm font-bold leading-6">
              <AlertCircle size={18} strokeWidth={3} />
              {mutationError}
            </p>
          </div>
        ) : null}

        {template ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant={template.is_system ? "inverse" : "secondary"}>
              {resolveTemplateScopeLabel(template, currentUserId)}
            </Badge>
            <Badge variant="muted">更新于 {formatRulesDate(template.updated_at)}</Badge>
          </div>
        ) : (
          <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
            <p className="text-sm font-bold leading-6">
              新建入口只会创建当前登录用户自己的模板，不会创建系统模板。
            </p>
          </div>
        )}

        <label className="space-y-2">
          <span className="text-sm font-black uppercase tracking-[0.14em]">模板名称</span>
          <Input
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            disabled={readOnly || saving || deleting}
            placeholder="例如：通用订单发票核对模板"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-black uppercase tracking-[0.14em]">模板说明</span>
          <Textarea
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            disabled={readOnly || saving || deleting}
            className="min-h-[8rem]"
            placeholder="说明适用场景、单据类型或使用边界。"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-black uppercase tracking-[0.14em]">规则内容</span>
          <Textarea
            value={draft.rulesText}
            onChange={(event) => onChange({ ...draft, rulesText: event.target.value })}
            disabled={readOnly || saving || deleting}
            className="min-h-[16rem]"
            placeholder="这里填写模板规则正文。"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-black uppercase tracking-[0.14em]">
            关联主体（每行一个）
          </span>
          <Textarea
            value={draft.companyAffiliatesText}
            onChange={(event) =>
              onChange({ ...draft, companyAffiliatesText: event.target.value })
            }
            disabled={readOnly || saving || deleting}
            className="min-h-[10rem]"
            placeholder="buyer&#10;seller&#10;notify_party"
          />
        </label>

        {readOnly ? (
          <div className="issue-blue p-4">
            <p className="text-sm font-bold leading-6">
              当前模板对你是只读的。普通用户可以查看系统模板，但不能直接修改；管理员也只在系统模板和自己可见范围内拥有维护权限。
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {!readOnly ? (
            <Button onClick={onSave} disabled={saving || deleting}>
              {saving ? (
                <Loader2 className="animate-spin" size={18} strokeWidth={3} />
              ) : (
                <Save size={18} strokeWidth={3} />
              )}
              {saving ? "保存中..." : mode === "create" ? "创建模板" : "保存模板"}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onReset} disabled={saving || deleting}>
            {mode === "create" ? "清空表单" : "恢复当前内容"}
          </Button>
          {template && canDelete ? (
            <Button variant="outline" onClick={onDelete} disabled={saving || deleting}>
              {deleting ? (
                <Loader2 className="animate-spin" size={18} strokeWidth={3} />
              ) : (
                <Trash2 size={18} strokeWidth={3} />
              )}
              {deleting ? "删除中..." : "删除模板"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
