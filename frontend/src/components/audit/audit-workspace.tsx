"use client";

import { useCallback, useEffect, useState } from "react";
import { FileStack, ScanSearch, TimerReset } from "lucide-react";

import { apiGet, apiPut, getStoredAccessToken } from "@/lib/api";
import { Dialog, DialogSection } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BrutalCard } from "@/components/ui/brutal-card";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatusPill } from "@/components/ui/status-pill";
import type { WizardProfile } from "@/components/wizard/types";

const sections = [
  {
    title: "PO 基准区",
    description: "后续放置基准采购订单上传、解析和字段锚点识别。"
  },
  {
    title: "待审核单据区",
    description: "后续放置多文件上传列表、解析状态和文档类型识别。"
  },
  {
    title: "审核结果区",
    description: "后续承接 RED / YELLOW / BLUE 三级问题结果与在线报告。"
  }
];

export function AuditWorkspace() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const loadDisclaimerState = useCallback(async (accessToken: string) => {
    try {
      const { data } = await apiGet<WizardProfile>("/settings/profile", {
        token: accessToken
      });
      if (data.wizard_completed && !data.disclaimer_accepted) {
        setOpen(true);
      }
    } catch {
      // 审核页骨架阶段不阻断主视图。
    }
  }, []);

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    setToken(accessToken);
    if (!accessToken) {
      return;
    }
    void loadDisclaimerState(accessToken);
  }, [loadDisclaimerState]);

  const handleAcceptDisclaimer = useCallback(async () => {
    if (!token) {
      setOpen(false);
      return;
    }

    setAccepting(true);
    try {
      await apiPut(
        "/settings/disclaimer",
        { disclaimer_accepted: true },
        { token }
      );
      setOpen(false);
    } finally {
      setAccepting(false);
    }
  }, [token]);

  return (
    <>
      <section className="space-y-6">
        <SectionHeading
          title="审核工作台"
          description="这一页当前仍是执行层接线后的骨架承载区。本轮只补了免责声明时序：完成 wizard 后进入这里，再决定是否展示免责声明。"
          icon={ScanSearch}
        />
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <BrutalCard title="工作区总览" tone="paper">
            <div className="grid gap-4 md:grid-cols-3">
              {sections.map((section) => (
                <div
                  key={section.title}
                  className="border-4 border-ink bg-muted p-4 shadow-neo-sm"
                >
                  <h3 className="mb-2 text-base font-black uppercase">
                    {section.title}
                  </h3>
                  <p className="text-sm leading-6">{section.description}</p>
                </div>
              ))}
            </div>
          </BrutalCard>
          <BrutalCard title="当前骨架状态" tone="mint">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <FileStack size={20} strokeWidth={3} />
                <StatusPill label="上传区待联调" tone="warning" />
              </div>
              <div className="flex items-center gap-3">
                <TimerReset size={20} strokeWidth={3} />
                <StatusPill label="SSE 结构已预留" />
              </div>
              <p className="text-sm leading-6">
                审核页完整业务联动不在这一轮范围内。当前只确保 wizard 完成后进入 audit 的体验顺序成立。
              </p>
            </div>
          </BrutalCard>
        </div>
      </section>

      <Dialog
        open={open}
        title="开始审核前请先确认"
        description="你已经完成了引导向导。免责声明会在进入审核页之后再弹出，而不是在 wizard 之前打断流程。"
        footer={
          <Button onClick={handleAcceptDisclaimer} disabled={accepting}>
            {accepting ? "确认中..." : "我已阅读并接受"}
          </Button>
        }
      >
        <DialogSection>
          <p className="text-sm font-bold leading-6">
            当前系统提供的是 AI 辅助审核建议，请你在正式对外发送单据前进行人工复核。
          </p>
          <p className="text-sm font-bold leading-6">
            这次确认会写入
            <code className="mx-1 rounded-none border-2 border-ink bg-secondary px-2 py-1">
              disclaimer_accepted
            </code>
            ，后续同一账号默认不再重复打断。
          </p>
        </DialogSection>
      </Dialog>
    </>
  );
}
