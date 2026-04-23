import { Building2, GitBranch, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import type {
  WizardAffiliateRole,
  WizardCompanyMode
} from "@/components/wizard/types";

type StepCompanyInfoProps = {
  companyMode: WizardCompanyMode;
  affiliateRoles: WizardAffiliateRole[];
  generatedAffiliates: string[];
  onCompanyModeChange: (mode: WizardCompanyMode) => void;
  onAddAffiliate: () => void;
  onRemoveAffiliate: (index: number) => void;
  onChangeAffiliate: (
    index: number,
    field: "company" | "role",
    value: string
  ) => void;
  onApplyGeneratedAffiliates: () => void;
};

export function StepCompanyInfo({
  companyMode,
  affiliateRoles,
  generatedAffiliates,
  onCompanyModeChange,
  onAddAffiliate,
  onRemoveAffiliate,
  onChangeAffiliate,
  onApplyGeneratedAffiliates
}: StepCompanyInfoProps) {
  return (
    <div className="space-y-6">
      <Card className="bg-paper">
        <CardHeader>
          <Badge variant="accent">步骤 4</Badge>
          <CardTitle>公司架构信息</CardTitle>
          <CardDescription>
            这里直接对齐后端字段
            <code className="mx-1 rounded-none border-2 border-ink bg-secondary px-2 py-1">
              company_affiliates
            </code>
            和
            <code className="mx-1 rounded-none border-2 border-ink bg-secondary px-2 py-1">
              company_affiliates_roles
            </code>
            ，不会再引入额外字段。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant={companyMode === "single" ? "primary" : "outline"}
            onClick={() => onCompanyModeChange("single")}
          >
            <Building2 size={18} strokeWidth={3} />
            独立公司
          </Button>
          <Button
            variant={companyMode === "group" ? "primary" : "outline"}
            onClick={() => onCompanyModeChange("group")}
          >
            <GitBranch size={18} strokeWidth={3} />
            集团公司
          </Button>
        </CardContent>
      </Card>

      {companyMode === "single" ? (
        <Card className="bg-muted">
          <CardHeader>
            <Badge variant="secondary">单主体模式</Badge>
            <CardTitle>当前按独立公司处理</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-bold leading-6">
              如果你的业务没有多个关联主体，这里可以不填写集团信息，直接进入确认步骤即可。
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="bg-secondary">
            <CardHeader>
              <Badge variant="inverse">集团信息</Badge>
              <CardTitle>维护关联公司和分工</CardTitle>
              <CardDescription>
                你可以手动维护关联公司，也可以把上一步 AI 生成的关联公司一键带入这里继续编辑。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={onAddAffiliate}>
                <Plus size={18} strokeWidth={3} />
                新增关联公司
              </Button>
              <Button
                variant="outline"
                onClick={onApplyGeneratedAffiliates}
                disabled={generatedAffiliates.length === 0}
              >
                使用 AI 生成结果
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {affiliateRoles.length > 0 ? (
              affiliateRoles.map((item, index) => (
                <Card key={`${item.company}-${index}`} className="bg-paper">
                  <CardHeader className="flex flex-row items-center justify-between gap-4">
                    <div className="space-y-2">
                      <Badge variant="muted">关联主体 {index + 1}</Badge>
                      <CardTitle>公司与分工说明</CardTitle>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRemoveAffiliate(index)}
                    >
                      <Trash2 size={18} strokeWidth={3} />
                      删除
                    </Button>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-bold uppercase tracking-[0.14em]">
                        公司名称
                      </span>
                      <Input
                        value={item.company}
                        onChange={(event) =>
                          onChangeAffiliate(index, "company", event.target.value)
                        }
                        placeholder="例如：Example Trading HK"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-bold uppercase tracking-[0.14em]">
                        分工说明
                      </span>
                      <Input
                        value={item.role}
                        onChange={(event) =>
                          onChangeAffiliate(index, "role", event.target.value)
                        }
                        placeholder="例如：下单主体 / 出货主体 / 收款主体"
                      />
                    </label>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card className="bg-paper">
                <CardContent>
                  <p className="text-sm font-bold leading-6">
                    还没有填写任何关联主体。你可以手动新增，也可以先让 AI 给出建议后再带入这里。
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
