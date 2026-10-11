import type { Metadata } from "next";
import Link from "next/link";

import { DismissControl } from "@/components/dismiss-controls";
import {
  formatAge,
  formatKstDay,
  PartialNotice,
  UrgencyLabel,
} from "@/components/request-ui";
import {
  getArchiveProject,
  getArchiveSummary,
} from "@/components/server-data";
import { VisibilityControl } from "@/components/visibility-controls";
import { slugifyProject } from "@/lib/blob";
import type { DecisionRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "보관함" };

type ArchivePageProps = {
  searchParams: Promise<{ project?: string | string[]; all?: string | string[] }>;
};

// Older copies listed per repeated card unless the page asks for all of them.
// One automated alert reached 309 copies; listing them all made the page heavy
// enough to misrender on a slow connection.
const REPEAT_ROWS = 20;

const backLink =
  "inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-bold text-[#92959c] transition-colors hover:text-white";
const titleLink =
  "mt-2 block text-[1.02rem] font-black leading-7 tracking-[-0.02em] text-[#ece9e2] transition-colors hover:text-white";

function Unavailable() {
  return (
    <div className="mt-6 rounded-2xl border border-[#5b452c] bg-[#1c1711] px-4 py-3 text-sm font-semibold leading-6 text-[#e7bd7b]">
      저장소에 잠시 연결할 수 없어요. 잠시 뒤 새로고침해 주세요.
    </div>
  );
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
      <Link href={`/${request.slug}`} className={titleLink}>
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

// The front page: which projects have something in the archive. Cards are
// listed one project at a time so this stays light as the archive grows.
async function ArchiveOverview() {
  const { projects, totals, partial, unavailable } = await getArchiveSummary();
  const totalParts = [
    totals.dormant > 0 ? `오래 기다린 카드 ${totals.dormant}장` : null,
    totals.superseded > 0 ? `반복해서 올라온 카드 ${totals.superseded}장` : null,
    totals.dismissed > 0 ? `치운 카드 ${totals.dismissed}장` : null,
  ].filter(Boolean);

  return (
    <main className="page-wrap">
      <Link href="/" className={backLink}>
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
        {totalParts.length > 0 ? (
          <p className="mt-3 text-sm font-bold leading-6 text-[#c8c7c3]">
            {totalParts.join(" · ")}
          </p>
        ) : null}
      </header>

      {unavailable ? <Unavailable /> : null}
      <div className="mt-6">
        <PartialNotice partial={partial} />
      </div>

      {projects.length === 0 && !unavailable ? (
        <p className="mt-4 text-sm font-semibold text-[#92959c]">보관함이 비어 있어요.</p>
      ) : (
        <ul className="space-y-3">
          {projects.map((summary) => {
            const parts = [
              summary.dormant > 0 ? `오래 기다린 ${summary.dormant}` : null,
              summary.superseded > 0 ? `반복 ${summary.superseded}` : null,
              summary.dismissed > 0 ? `치운 ${summary.dismissed}` : null,
            ].filter(Boolean);
            return (
              <li key={summary.project}>
                <Link
                  href={`/archive?project=${encodeURIComponent(summary.project)}`}
                  className="surface flex min-h-16 items-center justify-between gap-4 px-5 py-3 transition-colors hover:border-[#545963]"
                >
                  <span className="min-w-0">
                    <span className="block break-all text-sm font-black text-[#e2e0db]">
                      {summary.project}
                    </span>
                    <span className="mt-1 block text-xs font-bold text-[#8d9097]">
                      {parts.join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-[#8d9097]" aria-hidden="true">
                    →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

async function ArchiveProject({ project, all }: { project: string; all: boolean }) {
  const { dormant, repeats, dismissed, partial, unavailable } =
    await getArchiveProject(project);
  const now = Date.now();
  const repeatCount = repeats.reduce((sum, group) => sum + group.members.length, 0);
  const empty = dormant.length + repeatCount + dismissed.length === 0;

  return (
    <main className="page-wrap">
      <Link href="/archive" className={backLink}>
        <span aria-hidden="true">←</span>
        보관함 전체
      </Link>

      <header className="mt-7">
        <div className="eyebrow">보관함</div>
        <h1 className="mt-3 break-all text-[2.1rem] font-black leading-[1.12] tracking-[-0.055em] sm:text-5xl">
          {project}
        </h1>
        <Link
          href={`/${encodeURIComponent(project)}`}
          className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[#92959c] transition-colors hover:text-white"
        >
          이 프로젝트의 답할 카드 보기 <span aria-hidden="true">→</span>
        </Link>
      </header>

      {unavailable ? <Unavailable /> : null}
      <div className="mt-6">
        <PartialNotice partial={partial} />
      </div>

      {empty && !unavailable ? (
        <p className="mt-4 text-sm font-semibold text-[#92959c]">
          이 프로젝트는 보관함에 든 카드가 없어요.
        </p>
      ) : null}

      <Section
        title="오래 기다린 카드"
        count={dormant.length}
        note="올라온 지 일주일이 넘었거나 나중에 보겠다고 옮긴 카드입니다. 아직 필요한 카드는 「다시 꺼내기」를 누르면 첫 화면에 계속 보입니다."
      >
        <ul className="surface px-5">
          {dormant.map((request) => (
            <Row key={request.slug} request={request} now={now}>
              <VisibilityControl
                slug={request.slug}
                action="bring-back"
                previous={request.visibility ?? "auto"}
              />
              <DismissControl slug={request.slug} />
            </Row>
          ))}
        </ul>
      </Section>

      <Section
        title="반복해서 올라온 카드"
        count={repeatCount}
        note="같은 제목으로 다시 올라온 카드는 가장 새 것 하나만 첫 화면에 둡니다. 아래는 그 뒤에 접어 둔 이전 카드입니다."
      >
        {repeats.map(({ newest, members }) => {
          const since = formatKstDay(members[members.length - 1].createdAt);
          return (
            <details key={newest.slug} className="surface group overflow-hidden">
              <summary className="cursor-pointer list-none px-5 py-4 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-3 text-xs font-bold text-[#8d9097]">
                  <span>
                    이전 카드 {members.length}장{since ? ` · ${since}부터` : ""}
                  </span>
                  <span className="transition-transform group-open:rotate-180" aria-hidden="true">
                    ↓
                  </span>
                </span>
                <span className="mt-2 block text-[1.02rem] font-black leading-7 tracking-[-0.02em] text-[#ece9e2]">
                  {newest.title}
                </span>
              </summary>
              <div className="border-t border-[#292d34] px-5 pb-1 pt-4">
                <Link
                  href={`/${newest.slug}`}
                  className="inline-flex min-h-10 items-center gap-2 text-sm font-black text-[#ff8a70] transition-colors hover:text-white"
                >
                  가장 새 카드 열기 (
                  {newest.status === "open"
                    ? "답 기다리는 중"
                    : newest.status === "answered"
                      ? "답하셨어요"
                      : "치우셨어요"}
                  ) <span aria-hidden="true">→</span>
                </Link>
                {/* Plain links: a repeated alert can have hundreds of older copies,
                    and each is still answerable at its own page. */}
                <ul className="mt-2 pb-3">
                  {(all ? members : members.slice(0, REPEAT_ROWS)).map((request) => (
                    <li key={request.slug} className="border-t border-[#262a31] first:border-t-0">
                      <Link
                        href={`/${request.slug}`}
                        className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm font-semibold text-[#b9b8b4] transition-colors hover:text-white"
                      >
                        <span className="min-w-0 truncate">{request.title}</span>
                        <span className="shrink-0 text-xs text-[#74777e]">
                          {formatAge(request.createdAt, now)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {!all && members.length > REPEAT_ROWS ? (
                  <Link
                    href={`/archive?project=${encodeURIComponent(project)}&all=1`}
                    className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[#92959c] transition-colors hover:text-white"
                  >
                    더 오래된 카드 {members.length - REPEAT_ROWS}장도 보기 <span aria-hidden="true">→</span>
                  </Link>
                ) : null}
              </div>
            </details>
          );
        })}
      </Section>

      <Section
        title="치운 카드"
        count={dismissed.length}
        note="「이미 처리했어요」로 치운 카드입니다. 잘못 치웠으면 되돌릴 수 있어요."
      >
        <ul className="surface px-5">
          {dismissed.map((request) => (
            <Row key={request.slug} request={request} now={now}>
              <DismissControl slug={request.slug} initiallyDismissed />
            </Row>
          ))}
        </ul>
      </Section>
    </main>
  );
}

// Same canonical form as the project page: decode, then slugify (NFKC).
function canonicalProject(raw: string): string {
  try {
    return slugifyProject(raw);
  } catch {
    return raw;
  }
}

export default async function ArchivePage({ searchParams }: ArchivePageProps) {
  const { project, all } = await searchParams;
  const raw = Array.isArray(project) ? project[0] : project;
  return raw ? (
    <ArchiveProject project={canonicalProject(raw)} all={all === "1"} />
  ) : (
    <ArchiveOverview />
  );
}
