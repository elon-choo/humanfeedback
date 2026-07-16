import type { DecisionOption, DecisionRecommendation } from "@/lib/types";

function scopedId(idPrefix: string | undefined, id: string) {
  if (!idPrefix) {
    return id;
  }

  const safePrefix = encodeURIComponent(idPrefix)
    .replaceAll("%", "_")
    .replace(/[^A-Za-z0-9_-]/g, "-");
  return `${safePrefix}-${id}`;
}

interface DecisionOptionCardProps {
  option: DecisionOption;
  compact?: boolean;
  idPrefix?: string;
}

export function DecisionOptionCard({
  option,
  compact = false,
  idPrefix,
}: DecisionOptionCardProps) {
  return (
    <article
      id={scopedId(idPrefix, `option-${option.n}`)}
      className={`relative overflow-hidden border ${
        compact ? "rounded-[20px] p-4 sm:p-5" : "rounded-[24px] p-5 sm:p-7"
      } ${
        option.recommended
          ? "border-[#7a392c] bg-[#171313]"
          : "border-[#2d3138] bg-[#12151a]"
      }`}
    >
      {option.recommended ? (
        <div className="absolute right-0 top-0 rounded-bl-2xl bg-[#ff5a36] px-3 py-2 text-[0.7rem] font-black text-white">
          🤖 클로드 추천
        </div>
      ) : null}

      <div
        className={
          compact
            ? "grid grid-cols-[50px_minmax(0,1fr)] gap-3 sm:grid-cols-[64px_minmax(0,1fr)] sm:gap-4"
            : "grid grid-cols-[64px_minmax(0,1fr)] gap-4 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-6"
        }
      >
        <div
          className={`${
            compact
              ? "pt-1 text-[3rem] sm:text-[3.8rem]"
              : "pt-1 text-[3.9rem] sm:text-[5.2rem]"
          } font-black leading-none tracking-[-0.08em] ${
            option.recommended ? "text-[#ff6b4b]" : "text-[#f0ede6]"
          }`}
          aria-label={`${option.n}번`}
        >
          {option.n}
        </div>

        <div className={option.recommended ? (compact ? "pt-7" : "pt-7 sm:pt-6") : ""}>
          <h3
            className={`text-balance font-black leading-[1.35] tracking-[-0.025em] text-[#f7f4ed] ${
              compact ? "text-lg sm:text-xl" : "text-xl sm:text-2xl"
            }`}
          >
            {option.label}
          </h3>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#b4b5b7] sm:text-[0.95rem]">
            {option.whatChanges}
          </p>

          <div className="mt-5 space-y-2.5 border-t border-[#2c3037] pt-4 text-sm font-semibold leading-6">
            <p className="text-[#78dca1]">{option.upside}</p>
            <p className="text-[#e8b766]">{option.downside}</p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full border border-[#343941] bg-[#1b1f25] px-3 py-1.5 text-xs font-extrabold text-[#c2c2c1]">
              수고 {option.effort}
            </span>
            <span
              className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${
                option.reversible
                  ? "border-[#2f5040] bg-[#142219] text-[#83d9a7]"
                  : "border-[#5a4227] bg-[#241b11] text-[#e9bb72]"
              }`}
            >
              {option.reversible ? "↩ 되돌릴 수 있음" : "◆ 되돌리기 어려움"}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

interface RecommendationCardProps {
  recommendation: DecisionRecommendation | null;
  compact?: boolean;
  idPrefix?: string;
}

export function RecommendationCard({
  recommendation,
  compact = false,
  idPrefix,
}: RecommendationCardProps) {
  if (!recommendation) {
    return null;
  }

  const headingId = scopedId(idPrefix, "recommendation");

  return (
    <section
      className={`${compact ? "mt-5 p-4 sm:p-5" : "mt-7 p-5 sm:p-6"} rounded-[22px] border border-[#41454d] bg-[#171a1f]`}
      aria-labelledby={headingId}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#ff5a36] text-lg" aria-hidden="true">
          🤖
        </span>
        <div>
          <div className="text-xs font-black uppercase tracking-[0.1em] text-[#8e9198]">Claude&apos;s take</div>
          <h2 id={headingId} className="mt-0.5 text-base font-black">
            저는 {recommendation.n}번을 고르겠습니다
          </h2>
        </div>
      </div>
      <p className="mt-4 text-sm font-semibold leading-7 text-[#c0c1c1]">{recommendation.why}</p>
    </section>
  );
}

interface IgnoredCardProps {
  ifIgnored: string;
  compact?: boolean;
  idPrefix?: string;
}

export function IgnoredCard({ ifIgnored, compact = false, idPrefix }: IgnoredCardProps) {
  const headingId = scopedId(idPrefix, "ignored");

  return (
    <section
      className={`${compact ? "mt-5" : "mt-7"} flex gap-3 rounded-2xl border border-[#282c32] px-4 py-4 text-sm leading-6 text-[#85888f]`}
      aria-labelledby={headingId}
    >
      <span aria-hidden="true">⏳</span>
      <div>
        <h2 id={headingId} className="inline font-black text-[#a9aaad]">
          답 안 하면?{" "}
        </h2>
        <span className="font-medium">{ifIgnored}</span>
      </div>
    </section>
  );
}
