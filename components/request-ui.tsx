import Link from "next/link";

import type { DecisionRequest, Urgency } from "@/lib/types";

const urgencyMeta: Record<Urgency, { label: string; dot: string; text: string }> = {
  high: { label: "지금 필요", dot: "bg-[#ff5a36]", text: "text-[#ff8a70]" },
  medium: { label: "곧 필요", dot: "bg-[#efb85d]", text: "text-[#efc77f]" },
  low: { label: "여유 있음", dot: "bg-[#6d737d]", text: "text-[#a5a8ae]" },
};

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
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(
    new Date(timestamp),
  );
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

export function RequestCard({ request }: { request: DecisionRequest }) {
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
    </article>
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
