"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";

import { AnswerComposer } from "@/components/answer-composer";
import {
  DecisionOptionCard,
  IgnoredCard,
  RecommendationCard,
} from "@/components/decision-presentation";
import {
  EmptyInbox,
  formatAge,
  UrgencyLabel,
} from "@/components/request-ui";
import type { DecisionRequest } from "@/lib/types";

type BatchAnswerViewProps = {
  project: string;
  requests: DecisionRequest[];
  unavailable: boolean;
  renderedAt: number;
};

type BatchDecisionCardProps = {
  request: DecisionRequest;
  answered: boolean;
  renderedAt: number;
  onAnswered: (slug: string) => void;
};

function BatchDecisionCard({
  request,
  answered,
  renderedAt,
  onAnswered,
}: BatchDecisionCardProps) {
  const idPrefix = `batch-${request.slug}`;
  const headingId = `${idPrefix.replaceAll("/", "-")}-title`;
  const optionsId = `${idPrefix.replaceAll("/", "-")}-options`;

  return (
    <article
      className={`surface overflow-hidden transition duration-300 ${
        answered
          ? "border-[#31513d] bg-[#101713] opacity-60"
          : "border-[#30343b]"
      }`}
      aria-labelledby={headingId}
    >
      <div className="px-4 pb-5 pt-4 sm:px-7 sm:pb-7 sm:pt-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <UrgencyLabel urgency={request.urgency} compact />
          <span className="text-xs font-bold text-[#74777e]">
            {formatAge(request.createdAt, renderedAt)}
          </span>
          <span className="text-xs font-bold tabular-nums text-[#5f6269]">
            {request.date} · {String(request.seq).padStart(3, "0")}
          </span>
          {answered ? (
            <span
              className="ml-auto rounded-full border border-[#31513d] bg-[#142219] px-3 py-1.5 text-xs font-black text-[#78dca1]"
              aria-live="polite"
            >
              ✅ 답변됨
            </span>
          ) : (
            <Link
              href={`/${request.slug}`}
              className="ml-auto inline-flex min-h-10 items-center rounded-xl px-2 text-xs font-black text-[#777b83] transition-colors hover:text-white"
            >
              단독으로 열기 ↗
            </Link>
          )}
        </div>

        <h2
          id={headingId}
          className="mt-5 text-balance text-[1.7rem] font-black leading-[1.22] tracking-[-0.045em] text-[#f7f4ed] sm:text-[2.15rem]"
        >
          {request.title}
        </h2>
        <p className="mt-4 border-l-2 border-[#ff5a36] pl-4 text-[0.98rem] font-bold leading-7 text-[#c7c6c2] sm:text-base">
          {request.tldr}
        </p>

        <details className="group mt-6 overflow-hidden rounded-2xl border border-[#2d3138] bg-[#101318]">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-black text-[#d2d0cb] [&::-webkit-details-marker]:hidden">
            <span>자세히</span>
            <span
              className="text-[#777a81] transition-transform group-open:rotate-180"
              aria-hidden="true"
            >
              ↓
            </span>
          </summary>
          <div className="border-t border-[#292d34] px-4 pb-5 pt-1 sm:px-5">
            <section className="mt-4 rounded-2xl border border-[#53342c] bg-[#1b1412] p-4">
              <h3 className="text-xs font-black text-[#ff8b73]">지금 왜?</h3>
              <div className="prose-decision mt-2 text-sm font-semibold">
                <ReactMarkdown>{request.whyNow}</ReactMarkdown>
              </div>
            </section>

            <section className="mt-5">
              <h3 className="text-sm font-black text-[#e3e0da]">
                이걸 정하면 뭐가 달라지나
              </h3>
              <div className="prose-decision mt-2 text-sm">
                <ReactMarkdown>{request.stakes}</ReactMarkdown>
              </div>
            </section>

            <section className="mt-5 border-t border-[#292d34] pt-5">
              <h3 className="text-sm font-black text-[#e3e0da]">
                알아두면 좋은 맥락
              </h3>
              <div className="prose-decision mt-2 text-sm">
                <ReactMarkdown>{request.context}</ReactMarkdown>
              </div>
            </section>
          </div>
        </details>

        <section className="mt-7" aria-labelledby={optionsId}>
          <div className="mb-4 flex items-end justify-between gap-3">
            <h3
              id={optionsId}
              className="text-xl font-black tracking-[-0.035em] text-[#f1eee7]"
            >
              어떤 방향으로 갈까요?
            </h3>
            <span className="shrink-0 text-[0.68rem] font-bold text-[#6f7279]">
              번호로 바로 답하기
            </span>
          </div>
          <div className="space-y-3">
            {request.options.map((option) => (
              <DecisionOptionCard
                key={option.n}
                option={option}
                compact
                idPrefix={idPrefix}
              />
            ))}
          </div>
        </section>

        <RecommendationCard
          recommendation={request.recommendation}
          compact
          idPrefix={idPrefix}
        />
        <IgnoredCard
          ifIgnored={request.ifIgnored}
          compact
          idPrefix={idPrefix}
        />

        <section className="mt-6 border-t border-[#2b2f36] pt-5" aria-label="이 결정에 답하기">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div>
              <h3 className="text-sm font-black text-[#f0ede6]">
                여기서 바로 답하기
              </h3>
              <p className="mt-1 text-[0.7rem] font-semibold text-[#74777e]">
                숫자 · 음성 · 메모 중 편한 방법 하나면 됩니다
              </p>
            </div>
            <span className="text-xl" aria-hidden="true">
              ↓
            </span>
          </div>
          <AnswerComposer
            slug={request.slug}
            options={request.options}
            allowFreeform={request.allowFreeform}
            secretRequests={request.secretRequests}
            recipientPubKey={request.recipientPubKey}
            variant="inline"
            onAnswered={onAnswered}
          />
        </section>
      </div>
    </article>
  );
}

export function BatchAnswerView({
  project,
  requests,
  unavailable,
  renderedAt,
}: BatchAnswerViewProps) {
  const [answeredSlugs, setAnsweredSlugs] = useState<Set<string>>(
    () => new Set(),
  );

  const markAnswered = useCallback((slug: string) => {
    setAnsweredSlugs((current) => {
      if (current.has(slug)) return current;
      const next = new Set(current);
      next.add(slug);
      return next;
    });
  }, []);

  const remaining = Math.max(0, requests.length - answeredSlugs.size);

  return (
    <main className="page-wrap">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-bold text-[#92959c] transition-colors hover:text-white"
      >
        <span aria-hidden="true">←</span>
        전체 인박스
      </Link>

      <header className="mb-9 mt-7 sm:mb-12">
        <div className="eyebrow">Batch decisions</div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <h1 className="break-all text-[2.4rem] font-black leading-none tracking-[-0.055em] sm:text-5xl">
            {project}
          </h1>
          {requests.length > 0 ? (
            <div
              className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                remaining === 0
                  ? "border-[#31513d] bg-[#142219] text-[#78dca1]"
                  : "border-[#3b302e] bg-[#211714] text-[#ff8a70]"
              }`}
              aria-live="polite"
            >
              {remaining === 0 ? "모두 답변함" : `${remaining}개 남음`}
            </div>
          ) : null}
        </div>
        <p className="mt-4 max-w-2xl text-sm font-medium leading-6 text-[#92959c]">
          위에서 아래로 훑으며 번호를 누르거나 말하세요. 답한 카드는 그대로 남아 다음 결정으로 바로 이어집니다.
        </p>
      </header>

      {unavailable ? (
        <div className="mb-6 rounded-2xl border border-[#5b452c] bg-[#1c1711] px-4 py-3 text-sm font-semibold leading-6 text-[#e7bd7b]">
          결정함 저장소에 잠시 연결할 수 없어요. 잠시 뒤 새로고침해 주세요.
        </div>
      ) : null}

      {requests.length === 0 ? (
        <EmptyInbox project={project} />
      ) : (
        <div className="space-y-7 sm:space-y-9">
          {requests.map((request) => (
            <BatchDecisionCard
              key={request.slug}
              request={request}
              answered={answeredSlugs.has(request.slug)}
              renderedAt={renderedAt}
              onAnswered={markAnswered}
            />
          ))}
        </div>
      )}
    </main>
  );
}
