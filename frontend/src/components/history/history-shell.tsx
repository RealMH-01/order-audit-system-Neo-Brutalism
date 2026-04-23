"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, History, RefreshCcw } from "lucide-react";

import { HistoryDetail } from "@/components/history/history-detail";
import { HistoryList } from "@/components/history/history-list";
import {
  resolveHistoryFilterLabel,
  resolveHistoryIssueTotal,
  sortHistoryItems
} from "@/components/history/history-utils";
import type {
  HistoryDetailResponse,
  HistoryListItem,
  HistoryListResponse,
  HistoryStatusFilter
} from "@/components/history/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
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
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);

    try {
      const { data } = await apiGet<HistoryDetailResponse>(`/audit/history/${historyId}`, {
        token: accessToken
      });
      setDetail(data.item);
    } catch (error) {
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

        const sortedItems = sortHistoryItems(data.items);
        setItems(sortedItems);

        if (sortedItems.length === 0) {
          setActiveId(null);
          setDetail(null);
          setDetailError(null);
          return;
        }

        const nextActiveId =
          activeId && sortedItems.some((item) => item.id === activeId)
            ? activeId
            : sortedItems[0].id;

        void fetchDetail(nextActiveId, accessToken);
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

  const visibleIssueTotal = useMemo(
    () => filteredItems.reduce((sum, item) => sum + resolveHistoryIssueTotal(item), 0),
    [filteredItems]
  );

  if (!token) {
    return (
      <section className="space-y-6">
        <SectionHeading
          title="审核历史"
          description="历史页会复用当前登录态和审核结果流水线。请先完成登录或向导配置，再回来查看历史记录。"
          icon={History}
        />
        <Card className="bg-paper">
          <CardHeader>
            <Badge variant="accent">未登录</Badge>
            <CardTitle>请先完成登录或向导配置</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={() => router.push("/wizard")}>前往新手向导</Button>
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
        description="这里用于回看已完成的审核记录、查看真实详情结构，并与当前审核工作台保持产品链路一致。"
        icon={History}
      />

      <Card className="bg-secondary">
        <CardContent className="py-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">历史记录</p>
                <p className="mt-2 text-3xl font-black leading-none">{items.length}</p>
              </div>
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">当前筛选</p>
                <p className="mt-2 text-sm font-bold leading-6">
                  {resolveHistoryFilterLabel(filter)}
                </p>
              </div>
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">可见问题数</p>
                <p className="mt-2 text-3xl font-black leading-none">{visibleIssueTotal}</p>
              </div>
            </div>

            <div className="space-y-3 xl:max-w-md">
              <div className="flex items-center gap-2">
                <Clock3 size={18} strokeWidth={3} />
                <p className="text-sm font-black uppercase tracking-[0.14em]">
                  History 与 Audit 已接成一条链路
                </p>
              </div>
              <p className="text-sm font-bold leading-6">
                当前历史页已接上真实后端历史接口；如果你要重新上传单据、重新发起审核，直接回到审核工作台即可。
              </p>
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
                  disabled={listLoading}
                >
                  <RefreshCcw size={18} strokeWidth={3} />
                  {listLoading ? "刷新中..." : "刷新历史"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <HistoryList
          items={filteredItems}
          loading={listLoading}
          error={listError}
          activeId={activeId}
          filter={filter}
          onFilterChange={setFilter}
          onSelect={(historyId) => {
            if (!token) {
              return;
            }

            void fetchDetail(historyId, token);
          }}
          onRetry={() => {
            if (!token) {
              return;
            }

            void fetchList(token);
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
    </section>
  );
}
