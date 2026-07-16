import Link from "next/link";
import ReactMarkdown from "react-markdown";

import { AnswerComposer } from "@/components/answer-composer";
import {
  DecisionOptionCard,
  IgnoredCard,
  RecommendationCard,
} from "@/components/decision-presentation";
import { formatAge, UrgencyLabel } from "@/components/request-ui";
import type { DecisionRequest } from "@/lib/types";

export function DecisionContent({ request }: { request: DecisionRequest }) {
  return (
    <>
      <main
        className={`mx-auto w-full max-w-[820px] px-4 pt-5 sm:px-7 sm:pt-8 ${
          request.secretRequests?.length
            ? "pb-[520px] sm:pb-[470px]"
            : "pb-[360px] sm:pb-[320px]"
        }`}
      >
        <nav className="mb-8 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-bold text-[#94979d] transition-colors hover:text-white"
          >
            <span aria-hidden="true">←</span>
            결정 인박스
          </Link>
          <span className="text-xs font-bold tabular-nums text-[#666a72]">
            {request.date} · {String(request.seq).padStart(3, "0")}
          </span>
        </nav>

        <header>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/${encodeURIComponent(request.project)}`}
              className="rounded-full border border-[#3a3e46] bg-[#181b20] px-3 py-1.5 text-xs font-black text-[#dedcd7]"
            >
              {request.project}
            </Link>
            <UrgencyLabel urgency={request.urgency} compact />
            <span className="text-xs font-bold text-[#74777e]">{formatAge(request.createdAt)}</span>
          </div>

          <h1 className="mt-6 text-balance text-[2.1rem] font-black leading-[1.17] tracking-[-0.055em] text-[#f7f4ed] sm:text-[3.25rem]">
            {request.title}
          </h1>
          <p className="mt-5 border-l-2 border-[#ff5a36] pl-4 text-[1.02rem] font-bold leading-7 text-[#c9c8c4] sm:text-lg">
            {request.tldr}
          </p>
        </header>

        <section className="mt-10 rounded-[22px] border border-[#5d342c] bg-[#1d1412] p-5 sm:p-6" aria-labelledby="why-now">
          <h2 id="why-now" className="text-sm font-black text-[#ff8b73]">
            지금 왜?
          </h2>
          <p className="mt-2.5 text-[0.98rem] font-semibold leading-7 text-[#e8d8d3]">{request.whyNow}</p>
        </section>

        <section className="mt-9" aria-labelledby="stakes">
          <div className="eyebrow">The payoff</div>
          <h2 id="stakes" className="mt-2 text-[1.55rem] font-black tracking-[-0.035em] sm:text-3xl">
            이걸 정하면 뭐가 달라지나
          </h2>
          <div className="prose-decision mt-5 rounded-[22px] border border-[#2d3138] bg-[#15181d] p-5 text-[1.02rem] font-semibold sm:p-6">
            <ReactMarkdown>{request.stakes}</ReactMarkdown>
          </div>
        </section>

        <section className="mt-11" aria-labelledby="context">
          <h2 id="context" className="text-xl font-black tracking-[-0.025em]">
            알아두면 좋은 맥락
          </h2>
          <div className="prose-decision mt-4">
            <ReactMarkdown>{request.context}</ReactMarkdown>
          </div>
        </section>

        <section className="mt-12" aria-labelledby="options">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <div className="eyebrow">Pick one</div>
              <h2 id="options" className="mt-2 text-[1.65rem] font-black tracking-[-0.04em] sm:text-3xl">
                어떤 방향으로 갈까요?
              </h2>
            </div>
            <span className="shrink-0 text-xs font-bold text-[#70737a]">번호로 답하면 끝</span>
          </div>
          <div className="space-y-4">
            {request.options.map((option) => (
              <DecisionOptionCard option={option} key={option.n} />
            ))}
          </div>
        </section>

        <RecommendationCard recommendation={request.recommendation} />

        <IgnoredCard ifIgnored={request.ifIgnored} />
      </main>

      <AnswerComposer
        slug={request.slug}
        options={request.options}
        allowFreeform={request.allowFreeform}
        secretRequests={request.secretRequests}
        recipientPubKey={request.recipientPubKey}
      />
    </>
  );
}
