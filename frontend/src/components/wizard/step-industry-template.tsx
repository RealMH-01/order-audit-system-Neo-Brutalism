import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import type { WizardTemplateOption, WizardTemplateOptionId } from "@/components/wizard/types";

type StepIndustryTemplateProps = {
  options: WizardTemplateOption[];
  selectedTemplateId: WizardTemplateOptionId;
  onSelect: (value: WizardTemplateOptionId) => void;
};

export function StepIndustryTemplate({
  options,
  selectedTemplateId,
  onSelect
}: StepIndustryTemplateProps) {
  return (
    <div className="space-y-6">
      <Card className="bg-paper">
        <CardHeader>
          <Badge variant="accent">步骤 2</Badge>
          <CardTitle>选择行业模板</CardTitle>
          <CardDescription>
            这一轮先固定支持三种模板来源，状态只保留在前端并传给 wizard 后端接口。
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {options.map((option) => {
          const selected = option.id === selectedTemplateId;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              className={`text-left transition-all duration-100 ease-linear ${
                selected ? "-translate-y-1" : "hover:-translate-y-0.5"
              }`}
            >
              <Card className={selected ? "bg-acid shadow-neo-lg" : "bg-paper"}>
                <CardHeader>
                  <Badge variant={selected ? "inverse" : "secondary"}>
                    {selected ? "当前选择" : "可选模板"}
                  </Badge>
                  <CardTitle>{option.label}</CardTitle>
                  <CardDescription>{option.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
                    <p className="text-sm font-bold leading-6 whitespace-pre-line">
                      {option.rulesText || "不预设规则，由你自己从零开始。"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
