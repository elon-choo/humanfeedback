"use client";

import { useCallback, useState } from "react";

type Visibility = "keep" | "dormant" | "auto";

function visibilityEndpoint(slug: string): string {
  return `/api/requests/${slug
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}/visibility`;
}

async function postVisibility(slug: string, visibility: Visibility): Promise<void> {
  const response = await fetch(visibilityEndpoint(slug), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });

  if (
    response.status === 401 ||
    (response.redirected && new URL(response.url).pathname === "/unlock")
  ) {
    window.location.assign(
      `/unlock?next=${encodeURIComponent(window.location.pathname)}`,
    );
    throw new Error("잠금이 만료되어 다시 확인이 필요해요.");
  }

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: string }
    | null;
  if (!response.ok || !payload?.ok) {
    if (response.status === 409) {
      throw new Error("이미 답했거나 치운 결정이에요.");
    }
    if (response.status === 404) {
      throw new Error("이 결정을 찾을 수 없어요.");
    }
    throw new Error("옮기지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  }
}

/**
 * Moves an open decision between the main list and the archive.
 *
 * "park" (나중에 볼게요) sends it to the archive now; "bring-back" (다시 꺼내기)
 * pins it to the main list. One tap, because nothing is lost either way: the
 * result line keeps a 되돌리기 that puts back whatever was set before
 * (`previous`).
 */
export function VisibilityControl({
  slug,
  action,
  previous = "auto",
  onStateChange,
}: {
  slug: string;
  action: "park" | "bring-back";
  previous?: Visibility;
  onStateChange?: (moved: boolean) => void;
}) {
  const [moved, setMoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target: Visibility = action === "park" ? "dormant" : "keep";

  const run = useCallback(
    async (undo: boolean) => {
      setBusy(true);
      setError(null);
      try {
        await postVisibility(slug, undo ? previous : target);
        setMoved(!undo);
        onStateChange?.(!undo);
      } catch (moveError) {
        setError(
          moveError instanceof Error ? moveError.message : "옮기지 못했어요.",
        );
      } finally {
        setBusy(false);
      }
    },
    [onStateChange, previous, slug, target],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {moved ? (
        <>
          <span className="text-xs font-black text-[#78dca1]">
            {action === "park" ? "✓ 보관함으로 옮겼어요" : "✓ 첫 화면에 다시 꺼냈어요"}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(true)}
            className="inline-flex min-h-10 items-center rounded-xl border border-[#3a3e46] bg-[#171a20] px-3 text-xs font-black text-[#c8c7c3] transition-colors hover:border-[#545963] hover:text-white disabled:opacity-60"
          >
            되돌리기
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(false)}
          className={
            action === "park"
              ? "inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-black text-[#777b83] transition-colors hover:text-[#e2e0db] disabled:opacity-60"
              : "inline-flex min-h-10 items-center rounded-xl border border-[#3a3e46] bg-[#171a20] px-3 text-xs font-black text-[#c8c7c3] transition-colors hover:border-[#545963] hover:text-white disabled:opacity-60"
          }
        >
          {action === "park" ? "나중에 볼게요 · 보관함으로" : "다시 꺼내기"}
        </button>
      )}
      {error ? (
        <span className="text-xs font-bold text-[#ff8a70]">{error}</span>
      ) : null}
    </div>
  );
}
