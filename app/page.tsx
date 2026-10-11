import type { Metadata } from "next";
import Link from "next/link";

import { ArchiveLink, EmptyInbox, RequestCard } from "@/components/request-ui";
import { getOpenRequests } from "@/components/server-data";
import {
  APP_SHORT_BRAND,
  APP_TITLE,
  DASHBOARD_BRAND,
} from "@/lib/public-config";
import type { ListedDecisionRequest } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: APP_TITLE },
};

function groupByProject(requests: ListedDecisionRequest[]) {
  const groups = new Map<string, ListedDecisionRequest[]>();
  for (const request of requests) {
    const group = groups.get(request.project) ?? [];
    group.push(request);
    groups.set(request.project, group);
  }
  return [...groups.entries()];
}

export default async function DashboardPage() {
  const { requests, hidden, unavailable } = await getOpenRequests();
  const groups = groupByProject(requests);

  return (
    <main className="page-wrap">
      <header className="mb-9 sm:mb-12">
        <div className="flex items-center justify-between gap-4">
          <div className="eyebrow">{DASHBOARD_BRAND}</div>
          {requests.length > 0 ? (
            <div className="rounded-full border border-[#3b302e] bg-[#211714] px-3 py-1.5 text-xs font-black text-[#ff8a70]">
              {requests.length}개 대기 중
            </div>
          ) : null}
        </div>
        <h1 className="mt-4 text-[2.25rem] font-black leading-[1.12] tracking-[-0.055em] sm:text-5xl">
          지금, 내 결정이
          <br />
          필요한 일
        </h1>
        <p className="mt-4 max-w-xl text-[0.95rem] font-medium leading-7 text-[#96999f] sm:text-base">
          작은 선택 하나면 클로드가 다시 움직입니다. 급한 것부터 빠르게 끝내세요.
        </p>
      </header>

      {unavailable ? (
        <div className="mb-6 rounded-2xl border border-[#5b452c] bg-[#1c1711] px-4 py-3 text-sm font-semibold leading-6 text-[#e7bd7b]">
          {APP_SHORT_BRAND} 저장소에 잠시 연결할 수 없어요. 잠시 뒤 새로고침해 주세요.
        </div>
      ) : null}

      <ArchiveLink dormant={hidden.dormant} superseded={hidden.superseded} />

      {groups.length === 0 ? (
        <EmptyInbox />
      ) : (
        <div className="space-y-10">
          {groups.map(([project, items]) => (
            <section key={project} aria-labelledby={`project-${project}`}>
              <div className="mb-4 rounded-[1.4rem] border border-[#4a2d24] bg-[#1f1512] p-4 sm:flex sm:items-center sm:justify-between sm:gap-5 sm:p-5">
                <div className="flex items-center justify-between gap-4 px-1 sm:block">
                  <h2
                    id={`project-${project}`}
                    className="text-base font-black tracking-[-0.02em] text-[#f2eee7]"
                  >
                    {project}
                  </h2>
                  <span className="text-xs font-bold text-[#a9867c] sm:mt-1 sm:block">
                    {items.length}개 대기 중
                  </span>
                </div>
                <Link
                  href={`/${encodeURIComponent(project)}`}
                  className="mt-4 flex min-h-14 w-full items-center justify-between rounded-2xl bg-[#ff5a36] px-5 text-[0.95rem] font-black text-white transition-colors hover:bg-[#ff6747] active:scale-[0.985] sm:mt-0 sm:w-auto sm:min-w-[19rem]"
                >
                  <span>이 프로젝트 {items.length}건 한 번에 답하기</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {items.map((request) => (
                  <RequestCard request={request} key={request.slug} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
