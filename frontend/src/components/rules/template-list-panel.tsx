import { AlertCircle, BookOpenCheck, Loader2, Plus, RefreshCcw, Sparkles } from "lucide-react";

import type { RulesRole, TemplateItem } from "@/components/rules/types";
import {
  canEditTemplate,
  formatRulesDate,
  resolveTemplateScopeLabel
} from "@/components/rules/rules-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

type TemplateListPanelProps = {
  role: RulesRole | null;
  currentUserId: string | null;
  templates: TemplateItem[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  actionTemplateId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onLoad: (templateId: string) => void;
  onRetry: () => void;
};

export function TemplateListPanel({
  role,
  currentUserId,
  templates,
  loading,
  error,
  activeId,
  actionTemplateId,
  onSelect,
  onCreate,
  onLoad,
  onRetry
}: TemplateListPanelProps) {
  return (
    <Card className="bg-secondary">
      <CardHeader>
        <Badge variant="inverse">模板列表</Badge>
        <CardTitle>系统模板与我的模板</CardTitle>
        <CardDescription>
          当前列表接上 `/api/rules/templates`。后端会返回系统模板，以及当前用户自己创建的模板，不会暴露其他用户的模板。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <Badge variant="secondary">
              系统模板 {templates.filter((item) => item.is_system).length} 个
            </Badge>
            <Badge variant="muted">
              我的模板 {templates.filter((item) => !item.is_system).length} 个
            </Badge>
          </div>
          <Button onClick={onCreate}>
            <Plus size={18} strokeWidth={3} />
            新建用户模板
          </Button>
        </div>

        <ScrollArea className="max-h-[42rem] bg-secondary">
          <div className="space-y-3">
            {loading ? (
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="flex items-center gap-2 text-sm font-bold leading-6">
                  <Loader2 className="animate-spin" size={18} strokeWidth={3} />
                  正在加载模板列表...
                </p>
              </div>
            ) : error ? (
              <div className="space-y-4">
                <div className="issue-red p-4">
                  <p className="flex items-center gap-2 text-sm font-bold leading-6">
                    <AlertCircle size={18} strokeWidth={3} />
                    {error}
                  </p>
                </div>
                <Button variant="outline" onClick={onRetry}>
                  <RefreshCcw size={18} strokeWidth={3} />
                  重新读取模板列表
                </Button>
              </div>
            ) : templates.length > 0 ? (
              templates.map((template) => {
                const editable = canEditTemplate(template, role, currentUserId);

                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => onSelect(template.id)}
                    className={[
                      "w-full border-4 border-ink p-4 text-left shadow-neo-sm transition-all duration-100 ease-linear",
                      activeId === template.id
                        ? "bg-acid"
                        : "bg-paper hover:-translate-y-0.5 hover:bg-muted"
                    ].join(" ")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <p className="text-lg font-black tracking-tight">{template.name}</p>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={template.is_system ? "inverse" : "secondary"}>
                            {resolveTemplateScopeLabel(template, currentUserId)}
                          </Badge>
                          <Badge variant="muted">
                            {editable ? "当前可维护" : "当前仅查看"}
                          </Badge>
                          {template.company_affiliates.length > 0 ? (
                            <Badge variant="neutral">
                              关联主体 {template.company_affiliates.length} 个
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <Badge variant="neutral">
                        更新于 {formatRulesDate(template.updated_at)}
                      </Badge>
                    </div>

                    <p className="mt-3 text-sm font-bold leading-6">
                      {template.description || "当前模板未填写描述。"}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          onLoad(template.id);
                        }}
                        disabled={actionTemplateId === template.id}
                      >
                        {actionTemplateId === template.id ? (
                          <Loader2 className="animate-spin" size={18} strokeWidth={3} />
                        ) : (
                          <BookOpenCheck size={18} strokeWidth={3} />
                        )}
                        加载到当前规则
                      </Button>
                      {template.is_system ? (
                        <Badge variant="accent">
                          <Sparkles size={12} strokeWidth={3} />
                          系统内置
                        </Badge>
                      ) : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="issue-yellow p-4">
                <p className="text-sm font-bold leading-6">
                  当前还没有任何模板。你可以先创建一个用户模板，后续再加载到当前自定义规则。
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

