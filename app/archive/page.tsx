import type { Metadata } from "next";
import Link from "next/link";

import { DismissControl } from "@/components/dismiss-controls";
import { formatAge, UrgencyLabel } from "@/components/request-ui";
import { getArchive } from "@/components/server-data";
import { VisibilityControl } from "@/components/visibility-controls";
import type { ListedDecisionRequest } from "@/lib/lifecycle";
import type { DecisionRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "보관함" };

const shortDate = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" });

function byProject<T extends DecisionRequest>(requests: T[]) {
  const groups = new Map<string, T[]>();
  for (const request of requests) {
    const group = groups.get(request.project);
    if (group) group.push(request);
    else groups.set(request.project, [request]);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}

function Row({
  request,
  now,
  children,
}: {
  request: DecisionRequest;
  now: number;
  children: React.ReactNode;
}) {
  return (
    <li className="border-t border-[#262a31] py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <UrgencyLabel urgency={request.urgency} compact />
        <span className="text-xs font-semibold text-[#74777e]">
          {formatAge(request.createdAt, now)}
        </span>
      </div>
      <Link
        href={`/${request.slug}`}
        className="mt-2 block text-[1.02rem] font-black leading-7 tracking-[-0.02em] text-[#ece9e2] transition-colors hover:text-white"
      >
        {request.title}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">{children}</div>
    </li>
  );
}

function Section({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count: number;
  note: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-xl font-black tracking-[-0.03em] text-[#f2eee7]">
        {title} <span className="text-[#8d9097]">{count}장</span>
      </h2>
      <p className="mt-2 text-sm font-medium leading-6 text-[#92959c]">{note}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function ProjectFold({
  project,
  count,
  children,
}: {
  project: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <details className="surface group overflow-hidden">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-black text-[#e2e0db] [&::-webkit-details-marker]:hidden">
        <span className="break-all">{project}</span>
        <span className="flex shrink-0 items-center gap-3 text-xs font-bold text-[#8d9097]">
          {count}장
          <span className="transition-transform group-open:rotate-180" aria-hidden="true">
            ↓
          </span>
        </span>
      </summary>
      <ul className="border-t border-[#292d34] px-5">{children}</ul>
    </details>
  );
}

export default async function ArchivePage() {
  const { dormant, repeats, dismissed, unavailable } = await getArchive();
  const now = Date.now();
  const repeatCount = repeats.reduce((sum, group) => sum + group.hiddenCount, 0);
  const empty = dormant.length + repeatCount + dismissed.length === 0;

  return (
    <main className="page-wrap">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-bold text-[#92959c] transition-colors hover:text-white"
      >
        <span aria-hidden="true">←</span>
        전체 인박스
      </Link>

      <header className="mt-7">
        <h1 className="text-[2.25rem] font-black leading-[1.12] tracking-[-0.055em] sm:text-5xl">
          보관함
        </h1>
        <p className="mt-4 max-w-xl text-[0.95rem] font-medium leading-7 text-[#96999f]">
          첫 화면에서 뺀 카드를 모아 둔 곳입니다. 지운 카드는 없고, 여기서 열어 그대로 답할 수 있어요.
        </p>
      </header>

      {unavailable ? (
        <div className="mt-6 rounded-2xl border border-[#5b452c] bg-[#1c1711] px-4 py-3 text-sm font-semibold leading-6 text-[#e7bd7b]">
          저장소에 잠시 연결할 수 없어요. 잠시 뒤 새로고침해 주세요.
        </div>
      ) : null}

      {empty && !unavailable ? (
        <p className="mt-10 text-sm font-semibold text-[#92959c]">보관함이 비어 있어요.</p>
      ) : null}

      <Section
        title="오래 기다린 카드"
        count={dormant.length}
        note="올라온 지 일주일이 넘었거나 나중에 보겠다고 옮긴 카드입니다. 아직 필요한 카드는 「다시 꺼내기」를 누르면 첫 화면에 계속 보입니다."
      >
        {byProject<ListedDecisionRequest>(dormant).map(([project, items]) => (
          <ProjectFold key={project} project={project} count={items.length}>
            {items.map((request) => (
              <Row key={request.slug} request={request} now={now}>
                <VisibilityControl
                  slug={request.slug}
                  action="bring-back"
                  previous={request.visibility ?? "auto"}
                />
                <DismissControl slug={request.slug} />
              </Row>
            ))}
          </ProjectFold>
        ))}
      </Section>

      <Section
        title="반복해서 올라온 카드"
        count={repeatCount}
        note="같은 제목으로 다시 올라온 카드는 가장 새 것 하나만 첫 화면에 둡니다. 아래는 그 뒤에 접어 둔 이전 카드입니다."
      >
        <ul className="surface px-5">
          {repeats.map(({ newest, hiddenCount, firstCreatedAt }) => (
            <li key={newest.slug} className="border-t border-[#262a31] py-4 first:border-t-0">
              <div className="text-xs font-bold text-[#8d9097]">
                {newest.project} · 이전 카드 {hiddenCount}장 ·{" "}
                {shortDate.format(new Date(firstCreatedAt))}부터
              </div>
              <Link
                href={`/${newest.slug}`}
                className="mt-2 block text-[1.02rem] font-black leading-7 tracking-[-0.02em] text-[#ece9e2] transition-colors hover:text-white"
              >
                {newest.title}
              </Link>
              <div className="mt-1 text-xs font-semibold text-[#74777e]">
                가장 새 카드:{" "}
                {newest.status === "open"
                  ? "아직 답을 기다리고 있어요"
                  : newest.status === "answered"
                    ? "답하셨어요"
                    : "치우셨어요"}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="치운 카드"
        count={dismissed.length}
        note="「이미 처리했어요」로 치운 카드입니다. 잘못 치웠으면 되돌릴 수 있어요."
      >
        {byProject(dismissed).map(([project, items]) => (
          <ProjectFold key={project} project={project} count={items.length}>
            {items.map((request) => (
              <Row key={request.slug} request={request} now={now}>
                <DismissControl slug={request.slug} initiallyDismissed />
              </Row>
            ))}
          </ProjectFold>
        ))}
      </Section>
    </main>
  );
}
