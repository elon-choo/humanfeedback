import Link from "next/link";

import { DismissControl } from "@/components/dismiss-controls";
import { VisibilityControl } from "@/components/visibility-controls";
import type { CardGroup, ListedDecisionRequest } from "@/lib/lifecycle";
import type { Urgency } from "@/lib/types";

const urgencyMeta: Record<Urgency, { label: string; dot: string; text: string }> = {
  high: { label: "지금 필요", dot: "bg-[#ff5a36]", text: "text-[#ff8a70]" },
  medium: { label: "곧 필요", dot: "bg-[#efb85d]", text: "text-[#efc77f]" },
  low: { label: "여유 있음", dot: "bg-[#6d737d]", text: "text-[#a5a8ae]" },
};

const kstMonthDay = new Intl.DateTimeFormat("ko-KR", {
  // Fixed zone: the server (UTC) and the phone must print the same day.
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
});

export function formatAge(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "방금 등록";

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "방금 전";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  // Same day on the server (UTC) and the phone; the batch view renders this
  // on both, and a card kept in the main list can be weeks old.
  return kstMonthDay.format(timestamp);
}

export function UrgencyLabel({ urgency, compact = false }: { urgency: Urgency; compact?: boolean }) {
  const meta = urgencyMeta[urgency];
  return (
    <span className={`inline-flex items-center gap-2 font-bold ${meta.text} ${compact ? "text-xs" : "text-sm"}`}>
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** "10월 6일", or null for a date that cannot be read (Intl throws on those). */
export function formatKstDay(value: string): string | null {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? kstMonthDay.format(timestamp) : null;
}

// "같은 카드 12번째 · 9월 6일부터": this card was posted again and its older
// copies sit in the archive.
export function GroupBadge({ group }: { group: CardGroup }) {
  const since = formatKstDay(group.firstCreatedAt);
  return (
    <span className="rounded-full border border-[#3d3a2c] bg-[#1c1a12] px-2.5 py-1 text-[0.68rem] font-black text-[#d9c27a]">
      같은 카드 {group.count}번째{since ? ` · ${since}부터` : ""}
    </span>
  );
}

export function RequestCard({ request }: { request: ListedDecisionRequest }) {
  return (
    <article className="surface group overflow-hidden p-5 transition-colors hover:border-[#454a54] sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          href={`/${encodeURIComponent(request.project)}`}
          className="rounded-full border border-[#393d45] bg-[#1a1e24] px-3 py-1 text-xs font-extrabold tracking-wide text-[#e2e0db] transition-colors hover:border-[#ff5a36] hover:text-white"
        >
          {request.project}
        </Link>
        <UrgencyLabel urgency={request.urgency} compact />
        <span className="text-xs font-semibold text-[#74777e]">{formatAge(request.createdAt)}</span>
        {request.group ? <GroupBadge group={request.group} /> : null}
      </div>

      <h2 className="text-balance text-xl font-black leading-[1.38] tracking-[-0.025em] text-[#f7f4ed] sm:text-2xl">
        {request.title}
      </h2>
      <p className="mt-3 line-clamp-2 text-[0.95rem] font-medium leading-7 text-[#9fa1a6]">
        {request.tldr}
      </p>

      <Link
        href={`/${request.slug}`}
        className="mt-6 flex min-h-12 w-full items-center justify-between rounded-2xl border border-[#373b43] bg-[#191c22] px-4 text-sm font-extrabold text-[#c8c7c3] transition-colors hover:border-[#545963] hover:bg-[#1d2128] hover:text-white active:scale-[0.985]"
      >
        <span>이 결정만 답하기</span>
        <span aria-hidden="true">→</span>
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[#292d34] pt-3">
        <DismissControl slug={request.slug} />
        <VisibilityControl
          slug={request.slug}
          action="park"
          previous={request.visibility ?? "auto"}
        />
      </div>
    </article>
  );
}

// One line above the list: what the main list leaves out, and where it went.
export function ArchiveLink({
  hidden,
  project,
}: {
  hidden: { dormant: number; superseded: number; dismissed: number };
  project?: string;
}) {
  const parts = [
    hidden.dormant > 0 ? `오래 기다린 카드 ${hidden.dormant}장` : null,
    hidden.superseded > 0 ? `반복해서 올라온 카드 ${hidden.superseded}장` : null,
    hidden.dismissed > 0 ? `치운 카드 ${hidden.dismissed}장` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <Link
      href={project ? `/archive?project=${encodeURIComponent(project)}` : "/archive"}
      className="mb-8 flex min-h-14 items-center justify-between gap-4 rounded-2xl border border-[#30343b] bg-[#14171c] px-5 py-3 text-sm font-bold leading-6 text-[#a9abb0] transition-colors hover:border-[#545963] hover:text-white"
    >
      <span>
        <span className="font-black text-[#e2e0db]">보관함</span>
        <span className="ml-2">{parts.join(" · ")}</span>
      </span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}

// Some card files could not be read this time, so the list is short.
export function PartialNotice({ partial }: { partial: boolean }) {
  if (!partial) return null;
  return (
    <div className="mb-6 rounded-2xl border border-[#5b452c] bg-[#1c1711] px-4 py-3 text-sm font-semibold leading-6 text-[#e7bd7b]">
      카드 일부를 읽지 못했어요. 지금 보이는 목록과 숫자가 실제보다 적을 수 있습니다. 잠시 뒤 새로고침해 주세요.
    </div>
  );
}

export function EmptyInbox({ project }: { project?: string }) {
  return (
    <div className="surface px-6 py-14 text-center sm:py-20">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-[#30343c] bg-[#181b21] text-3xl">
        ✓
      </div>
      <h2 className="mt-6 text-2xl font-black tracking-[-0.03em]">지금은 결정할 게 없어요</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm font-medium leading-6 text-[#92959b]">
        {project ? `${project}의 대기 중인 결정이 모두 끝났습니다.` : "결정 인박스가 깨끗합니다. 하던 일에 집중하세요."}
      </p>
    </div>
  );
}
