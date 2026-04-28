"use client";

// DEPRECATED: 自 Task 4.1 起不再被 /admin/rules 页面引用，旧 built-in 规则页面不再作为当前规则维护入口。后续清理轮次再物理删除。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FolderKanban, Library, Loader2, ShieldCheck, ShieldOff } from "lucide-react";

import { BuiltinRulesPanel } from "@/components/rules/builtin-rules-panel";
import type {
  BuiltinRuleFull,
  BuiltinRulePublic,
  BuiltinRuleUpdatePayload
} from "@/components/rules/types";
import { normalizeError } from "@/components/rules/rules-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import type { WizardProfile } from "@/components/wizard/types";
import { apiGet, apiPut, getStoredAccessToken } from "@/lib/api";

export function RulesAdminShell() {
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<WizardProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [builtinPublic, setBuiltinPublic] = useState<BuiltinRulePublic | null>(null);
  const [builtinFull, setBuiltinFull] = useState<BuiltinRuleFull | null>(null);
  const [builtinDisplayText, setBuiltinDisplayText] = useState("");
  const [builtinPromptText, setBuiltinPromptText] = useState("");
  const [builtinLoading, setBuiltinLoading] = useState(true);
  const [builtinError, setBuiltinError] = useState<string | null>(null);
  const [builtinSaving, setBuiltinSaving] = useState(false);

  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(
    null
  );

  const loadProfile = useCallback(async (accessToken: string) => {
    setProfileLoading(true);
    setProfileError(null);

    try {
      const { data } = await apiGet<WizardProfile>("/settings/profile", {
        token: accessToken
      });
      setProfile(data);
      return data;
    } catch (error) {
      setProfile(null);
      setProfileError(normalizeError(error, "读取当前账号资料失败，请稍后重试。"));
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadBuiltin = useCallback(async (accessToken: string, role: WizardProfile["role"]) => {
    setBuiltinLoading(true);
    setBuiltinError(null);

    try {
      const { data: publicData } = await apiGet<BuiltinRulePublic>("/rules/builtin", {
        token: accessToken
      });
      setBuiltinPublic(publicData);
      setBuiltinFull(null);
      setBuiltinDisplayText(publicData.display_text);
      setBuiltinPromptText("");

      if (role === "admin") {
        const { data: fullData } = await apiGet<BuiltinRuleFull>("/rules/builtin/full", {
          token: accessToken
        });
        setBuiltinFull(fullData);
        setBuiltinDisplayText(fullData.display_text);
        setBuiltinPromptText(fullData.prompt_text);
      }
    } catch (error) {
      setBuiltinError(normalizeError(error, "读取系统规则失败，请稍后重试。"));
    } finally {
      setBuiltinLoading(false);
    }
  }, []);

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    setToken(accessToken);

    if (!accessToken) {
      setProfileLoading(false);
      setBuiltinLoading(false);
      return;
    }

    void (async () => {
      const currentProfile = await loadProfile(accessToken);
      if (!currentProfile) {
        setBuiltinLoading(false);
        return;
      }

      await loadBuiltin(accessToken, currentProfile.role);
    })();
  }, [loadBuiltin, loadProfile]);

  const builtinDirty = useMemo(() => {
    if (profile?.role !== "admin" || !builtinFull) {
      return false;
    }

    return (
      builtinDisplayText !== builtinFull.display_text || builtinPromptText !== builtinFull.prompt_text
    );
  }, [builtinDisplayText, builtinFull, builtinPromptText, profile?.role]);

  const handleSaveBuiltin = useCallback(async () => {
    if (!token || profile?.role !== "admin") {
      return;
    }

    if (!builtinDisplayText.trim() || !builtinPromptText.trim()) {
      setFeedback({
        tone: "error",
        message: "系统规则保存前请完整填写展示规则和 Prompt 规则。"
      });
      return;
    }

    setBuiltinSaving(true);
    setFeedback(null);

    const payload: BuiltinRuleUpdatePayload = {
      display_text: builtinDisplayText.trim(),
      prompt_text: builtinPromptText.trim()
    };

    try {
      const { data } = await apiPut<BuiltinRuleFull>("/rules/builtin", payload, {
        token
      });
      setBuiltinFull(data);
      setBuiltinPublic(data);
      setBuiltinDisplayText(data.display_text);
      setBuiltinPromptText(data.prompt_text);
      setFeedback({
        tone: "success",
        message: "系统规则已保存。"
      });
    } catch (error) {
      setFeedback({ tone: "error", message: normalizeError(error, "保存系统规则失败，请稍后重试。") });
    } finally {
      setBuiltinSaving(false);
    }
  }, [builtinDisplayText, builtinPromptText, profile?.role, token]);

  if (profileLoading) {
    return (
      <section className="space-y-6">
        <Card className="bg-paper">
          <CardContent className="flex items-center gap-3 py-10">
            <Loader2 className="animate-spin" size={20} strokeWidth={3} />
            <p className="text-sm font-bold uppercase tracking-[0.14em]">
              正在读取规则管理配置
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (!token) {
    return (
      <section className="space-y-6">
        <SectionHeading
          title="规则管理"
          description="规则管理页依赖当前登录态。请先完成登录或向导配置，再回来查看系统规则。"
          icon={FolderKanban}
        />
        <Card className="bg-paper">
          <CardHeader>
            <Badge variant="accent">未登录</Badge>
            <CardTitle>请先进入向导或完成登录</CardTitle>
            <CardDescription>
              `/admin/rules` 会读取当前账号的角色和系统规则权限边界，没有 token 时不会请求规则接口。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={() => router.push("/wizard")}>
              <ArrowRight size={18} strokeWidth={3} />
              前往新手向导
            </Button>
            <Button variant="outline" onClick={() => router.push("/settings")}>
              前往设置页
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <SectionHeading
        title="规则管理"
        description="这里用于查看通用系统规则，并在管理员权限下维护 built-in 规则。多套自定义规则集请使用规则模板页。"
        icon={FolderKanban}
      />

      {profileError ? (
        <div className="issue-red p-4">
          <p className="text-sm font-bold leading-6">{profileError}</p>
        </div>
      ) : null}

      {feedback ? (
        <div className={feedback.tone === "success" ? "issue-blue p-4" : "issue-red p-4"}>
          <p className="text-sm font-bold leading-6">{feedback.message}</p>
        </div>
      ) : null}

      <Card className="bg-acid">
        <CardContent className="py-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <Badge variant="inverse">
                  当前角色：{profile?.role === "admin" ? "管理员" : "普通用户"}
                </Badge>
                <Badge variant="secondary">旧规则接口已下线</Badge>
              </div>
              <p className="max-w-3xl text-sm font-bold leading-6">
                旧的规则接口不再作为产品功能提供，也不会再把历史内容写入当前自定义规则。
                审核工作台使用的自定义规则集来自规则模板页，并通过 `template_id` 参与最终审核。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => router.push("/settings")}>
                前往当前规则配置
              </Button>
              <Button onClick={() => router.push("/templates")}>
                <Library size={18} strokeWidth={3} />
                打开规则模板
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <Card className="bg-muted">
          <CardHeader>
            <Badge variant={profile?.role === "admin" ? "secondary" : "muted"}>
              权限边界
            </Badge>
            <CardTitle>当前账号在本页可做什么？</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <p className="flex items-center gap-2 text-sm font-bold leading-6">
                {profile?.role === "admin" ? (
                  <ShieldCheck size={18} strokeWidth={3} />
                ) : (
                  <ShieldOff size={18} strokeWidth={3} />
                )}
                {profile?.role === "admin"
                  ? "你当前是管理员：可读取并修改系统 built-in 规则。"
                  : "你当前是普通用户：系统 built-in 规则为只读查看。"}
              </p>
            </div>
            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <p className="text-sm font-bold leading-6">
                用户自定义规则仍在设置页和向导链路中维护，不受旧规则接口下线影响。
              </p>
            </div>
            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <p className="text-sm font-bold leading-6">
                自定义规则集请在规则模板页维护。审核工作台选择规则集后，其中的自定义规则会进入最终审核。
              </p>
            </div>
          </CardContent>
        </Card>

        <BuiltinRulesPanel
          role={profile?.role ?? null}
          loading={builtinLoading}
          error={builtinError}
          publicRule={builtinPublic}
          fullRule={builtinFull}
          displayText={builtinDisplayText}
          promptText={builtinPromptText}
          saving={builtinSaving}
          onDisplayTextChange={setBuiltinDisplayText}
          onPromptTextChange={setBuiltinPromptText}
          onSave={() => void handleSaveBuiltin()}
          onReset={() => {
            if (profile?.role === "admin" && builtinFull) {
              setBuiltinDisplayText(builtinFull.display_text);
              setBuiltinPromptText(builtinFull.prompt_text);
              return;
            }

            if (builtinPublic) {
              setBuiltinDisplayText(builtinPublic.display_text);
            }
          }}
          onRetry={() => {
            if (!token || !profile) {
              return;
            }

            void loadBuiltin(token, profile.role);
          }}
        />
      </div>

      {builtinDirty && profile?.role === "admin" ? (
        <div className="issue-yellow p-4">
          <p className="text-sm font-bold leading-6">
            系统规则存在未保存修改。点击“保存系统规则”后才会写回 `/api/rules/builtin`。
          </p>
        </div>
      ) : null}
    </section>
  );
}
