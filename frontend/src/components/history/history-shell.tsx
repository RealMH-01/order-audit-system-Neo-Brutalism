"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, History, RefreshCcw } from "lucide-react";

import { HistoryDetail } from "@/components/history/history-detail";
import { HistoryList } from "@/components/history/history-list";
import {
  resolveHistoryFilterLabel,
  resolveHistoryIssueTotal,
  resolveHistoryStatus,
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

const HISTORY_PAGE_SIZE = 20;

export function HistoryShell() {
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
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
    } catch {
      setDetailError("历史详情读取失败，请稍后重试。");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const fetchList = useCallback(
    async (accessToken: string, page = 1, append = false) => {
      setListLoading(true);
      setListError(null);

      try {
        const { data } = await apiGet<HistoryListResponse>(
          `/audit/history?page=${page}&page_size=${HISTORY_PAGE_SIZE}`,
          {
            token: accessToken
          }
        );

        const sortedPageItems = sortHistoryItems(data.items);
        const nextItems = sortedPageItems;
        if (append) {
          setItems((previous) => sortHistoryItems([...previous, ...sortedPageItems]));
        } else {
          setItems(nextItems);
        }
        setCurrentPage(data.page ?? page);
        setTotalCount((previous) => data.total_count ?? (append ? previous : nextItems.length));

        if (append) {
          return;
        }

        if (nextItems.length === 0) {
          setActiveId(null);
          setDetail(null);
          setDetailError(null);
          return;
        }

        const nextActiveId =
          activeId && nextItems.some((item) => item.id === activeId)
            ? activeId
            : nextItems[0].id;

        void fetchDetail(nextActiveId, accessToken);
      } catch {
        setListError("历史记录读取失败，请稍后重试。");
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

    void fetchList(accessToken, 1, false);
  }, [fetchList]);

  const filteredItems = useMemo(() => {
    if (filter === "ALL") {
      return items;
    }

    return items.filter((item) => resolveHistoryStatus(item) === filter);
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
          description="请先完成登录或向导配置，再回来查看已经完成的审核记录。"
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
        description="这里展示你已经完成的审核记录。点击左侧记录后，可以在右侧查看详情并重新下载报告。"
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
                  审核记录随时回看
                </p>
              </div>
              <p className="text-sm font-bold leading-6">
                你可以在这里筛选记录、查看问题汇总，也可以回到审核工作台继续上传单据并发起新审核。
              </p>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => router.push("/audit")}>返回审核工作台</Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!token) {
                      return;
                    }

                    void fetchList(token, 1, false);
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
        <div>
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

              void fetchList(token, 1, false);
            }}
          />

          {items.length < totalCount ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                onClick={() => {
                  if (!token) {
                    return;
                  }

                  void fetchList(token, currentPage + 1, true);
                }}
                disabled={listLoading}
              >
                {listLoading ? "加载中..." : "加载更多"}
              </Button>
            </div>
          ) : null}
        </div>

        <HistoryDetail
          item={detail}
          loading={detailLoading}
          error={detailError}
          token={token}
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
