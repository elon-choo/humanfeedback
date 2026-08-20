"use client";

import { useCallback, useState } from "react";

type DismissState = "idle" | "confirming" | "working" | "dismissed";

function dismissEndpoint(slug: string): string {
  return `/api/requests/${slug
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}/dismiss`;
}

async function postDismiss(slug: string, restore: boolean): Promise<void> {
  const response = await fetch(dismissEndpoint(slug), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restore }),
  });

  if (response.redirected && new URL(response.url).pathname === "/unlock") {
    window.location.assign(
      `/unlock?next=${encodeURIComponent(window.location.pathname)}`,
    );
    throw new Error("잠금이 만료되어 다시 확인이 필요해요.");
  }

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: string }
    | null;

  if (!response.ok || !payload?.ok) {
    if (response.status === 401) {
      window.location.assign(
        `/unlock?next=${encodeURIComponent(window.location.pathname)}`,
      );
    }
    if (response.status === 409) {
      throw new Error("이미 답한 결정이라 치울 수 없어요.");
    }
    if (response.status === 404) {
      throw new Error("이 결정을 찾을 수 없어요.");
    }
    throw new Error(payload?.error || "치우지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  }
}

/**
 * "이미 처리했어요" control for an UNANSWERED decision.
 *
 * Two-step (tap → confirm) because a stray tap on a phone would otherwise hide a
 * decision the owner still needs; and every dismissal keeps a 되돌리기 (restore)
 * affordance, so nothing is ever one tap away from being lost.
 */
export function DismissControl({
  slug,
  onStateChange,
  align = "start",
}: {
  slug: string;
  onStateChange?: (dismissed: boolean) => void;
  align?: "start" | "end";
}) {
  const [state, setState] = useState<DismissState>("idle");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (restore: boolean) => {
      setState("working");
      setError(null);
      try {
        await postDismiss(slug, restore);
        const dismissed = !restore;
        setState(dismissed ? "dismissed" : "idle");
        onStateChange?.(dismissed);
      } catch (dismissError) {
        setError(
          dismissError instanceof Error
            ? dismissError.message
            : "치우지 못했어요.",
        );
        setState(restore ? "dismissed" : "confirming");
      }
    },
    [onStateChange, slug],
  );

  const wrap = `flex flex-wrap items-center gap-2 ${
    align === "end" ? "justify-end" : ""
  }`;

  if (state === "dismissed") {
    return (
      <div className={wrap}>
        <span className="text-xs font-black text-[#78dca1]">✓ 치웠어요</span>
        <button
          type="button"
          onClick={() => void run(true)}
          className="inline-flex min-h-10 items-center rounded-xl border border-[#3a3e46] bg-[#171a20] px-3 text-xs font-black text-[#c8c7c3] transition-colors hover:border-[#545963] hover:text-white"
        >
          되돌리기
        </button>
        {error ? (
          <span className="text-xs font-bold text-[#ff8a70]">{error}</span>
        ) : null}
      </div>
    );
  }

  if (state === "confirming" || state === "working") {
    const busy = state === "working";
    return (
      <div className={wrap}>
        <span className="text-xs font-bold text-[#9fa1a6]">정말 치울까요?</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(false)}
          className="inline-flex min-h-10 items-center rounded-xl border border-[#5b3229] bg-[#241612] px-3 text-xs font-black text-[#ff8a70] transition-colors hover:border-[#ff5a36] disabled:opacity-60"
        >
          {busy ? "치우는 중…" : "네, 치울게요"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError(null);
            setState("idle");
          }}
          className="inline-flex min-h-10 items-center rounded-xl px-3 text-xs font-black text-[#83868d] transition-colors hover:text-white disabled:opacity-60"
        >
          취소
        </button>
        {error ? (
          <span className="text-xs font-bold text-[#ff8a70]">{error}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={wrap}>
      <button
        type="button"
        onClick={() => setState("confirming")}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-black text-[#777b83] transition-colors hover:text-[#e2e0db]"
      >
        <span aria-hidden="true">✕</span>
        이미 처리했어요 · 치우기
      </button>
    </div>
  );
}
