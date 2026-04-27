import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type StepIndustryTemplateProps = {
  businessBackground: string;
  onBusinessBackgroundChange: (value: string) => void;
};

export function StepIndustryTemplate({
  businessBackground,
  onBusinessBackgroundChange
}: StepIndustryTemplateProps) {
  return (
    <div className="space-y-6">
      <Card className="bg-paper">
        <CardHeader>
          <Badge variant="accent">步骤 2</Badge>
          <CardTitle>说明你的业务背景</CardTitle>
          <CardDescription>
            告诉 AI 你所在的行业或主要业务场景。后续规则配置时，AI 会基于这些背景提出更贴近你业务的问题。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="space-y-2">
            <span className="text-sm font-bold uppercase tracking-[0.14em]">
              行业或业务背景
            </span>
            <Textarea
              value={businessBackground}
              onChange={(event) => onBusinessBackgroundChange(event.target.value)}
              className="min-h-[14rem]"
              placeholder="例如：我们是化工品贸易公司，主要处理客户订单、PO、合同和发票。后续请根据这个背景帮助我配置审核规则。"
            />
          </label>
          <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
            <p className="text-sm font-bold leading-6">
              业务背景只用于帮助 AI 更好地追问和生成初始规则，完成向导后，生成结果会保存为你的自定义规则。
            </p>
          </div>
          <div className="issue-yellow p-4">
            <p className="text-sm font-bold leading-6">
              也可以暂时留空，AI 会按通用订单审核场景继续提问。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
