"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, History, RefreshCcw } from "lucide-react";

import { HistoryDetail } from "@/components/history/history-detail";
import { HistoryList } from "@/components/history/history-list";
import type {
  HistoryDetailResponse,
  HistoryListItem,
  HistoryListResponse,
  HistoryStatusFilter
} from "@/components/history/types";
import { SectionHeading } from "@/components/ui/section-heading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiGet, getStoredAccessToken } from "@/lib/api";

function normalizeError(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "detail" in error) {
    return String(error.detail);
  }

  return fallback;
}

export function HistoryShell() {
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryDetailResponse["item"] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryStatusFilter>("ALL");

  const fetchDetail = useCallback(async (historyId: string, accessToken: string) => {
    setActiveId(historyId);
    setDetailLoading(true);
    setDetailError(null);

    try {
      const { data } = await apiGet<HistoryDetailResponse>(`/audit/history/${historyId}`, {
        token: accessToken
      });
      setDetail(data.item);
    } catch (error) {
      setDetail(null);
      setDetailError(normalizeError(error, "读取审核历史详情失败，请稍后重试。"));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const fetchList = useCallback(
    async (accessToken: string) => {
      setListLoading(true);
      setListError(null);

      try {
        const { data } = await apiGet<HistoryListResponse>("/audit/history", {
          token: accessToken
        });

        const sortedItems = [...data.items].sort((left, right) => {
          const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
          const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
          return rightTime - leftTime;
        });

        setItems(sortedItems);

        if (sortedItems.length > 0) {
          const nextActiveId =
            activeId && sortedItems.some((item) => item.id === activeId)
              ? activeId
              : sortedItems[0].id;
          void fetchDetail(nextActiveId, accessToken);
        } else {
          setActiveId(null);
          setDetail(null);
        }
      } catch (error) {
        setListError(normalizeError(error, "读取审核历史列表失败，请稍后重试。"));
      } finally {
        setListLoading(false);
      }
    },
    [activeId, fetchDetail]
  );

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    setToken(accessToken);

    if (!accessToken) {
      setListLoading(false);
      return;
    }

    void fetchList(accessToken);
  }, [fetchList]);

  const filteredItems = useMemo(() => {
    if (filter === "COMPLETED") {
      return items;
    }

    return items;
  }, [filter, items]);

  if (!token) {
    return (
      <section className="space-y-6">
        <SectionHeading
          title="审核历史"
          description="历史页会复用当前登录态和审核结果流水线。请先登录，再查看历史记录。"
          icon={History}
        />
        <Card className="bg-paper">
          <CardHeader>
            <Badge variant="accent">未登录</Badge>
            <CardTitle>请先完成登录或引导配置</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={() => router.push("/wizard")}>前往引导向导</Button>
            <Button variant="outline" onClick={() => router.push("/audit")}>
              返回审核工作台
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <SectionHeading
        title="审核历史"
        description="这里用于回看过去的审核记录、查看基础详情，并与当前审核工作台形成同一条产品链路。"
        icon={History}
      />

      {listError ? (
        <div className="issue-red p-4">
          <p className="text-sm font-bold leading-6">{listError}</p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <HistoryList
          items={filteredItems}
          loading={listLoading}
          activeId={activeId}
          filter={filter}
          onFilterChange={setFilter}
          onSelect={(historyId) => {
            if (!token) {
              return;
            }
            void fetchDetail(historyId, token);
          }}
        />

        <HistoryDetail
          item={detail}
          loading={detailLoading}
          error={detailError}
          onRetry={() => {
            if (!token || !activeId) {
              return;
            }
            void fetchDetail(activeId, token);
          }}
          onGoAudit={() => router.push("/audit")}
        />
      </div>

      <Card className="bg-secondary">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Clock3 size={18} strokeWidth={3} />
              <p className="text-sm font-black uppercase tracking-[0.14em]">
                历史与审核工作台保持联动
              </p>
            </div>
            <p className="text-sm font-bold leading-6">
              如果你想继续上传新文件、重新发起审核，直接回到审核工作台即可。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => router.push("/audit")}>返回审核工作台</Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!token) {
                  return;
                }
                void fetchList(token);
              }}
            >
              <RefreshCcw size={18} strokeWidth={3} />
              刷新历史
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
