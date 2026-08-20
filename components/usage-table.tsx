"use client";

import { useEffect, useState } from "react";

import type { UsageSnapshot, UsageWindow } from "@/lib/types";

const REFRESH_MS = 60_000; // client re-poll; the pusher itself refreshes the blob every ~3 min.

/** Higher pct = more consumed = worse. Maps to a traffic-light tint. */
function tint(pct: number | null | undefined): { fg: string; bg: string } {
  if (pct == null) return { fg: "#8b8f96", bg: "transparent" };
  if (pct >= 90) return { fg: "#ff8a70", bg: "#2a1512" }; // 거의 소진
  if (pct >= 70) return { fg: "#e7bd7b", bg: "#241c11" }; // 주의
  return { fg: "#8fe0a6", bg: "#12211a" }; // 여유
}

function Cell({ w }: { w: UsageWindow | null }) {
  if (!w) return <td className="px-2 py-2 text-center text-[#5f636b]">—</td>;
  const t = tint(w.pct);
  return (
    <td className="px-2 py-2 text-center" style={{ backgroundColor: t.bg }}>
      <div className="text-[0.95rem] font-black leading-none" style={{ color: t.fg }}>
        {Math.round(w.pct)}%
      </div>
      {w.countdown ? (
        <div className="mt-1 text-[0.65rem] font-medium leading-none text-[#8b8f96]">
          {w.countdown}
        </div>
      ) : null}
    </td>
  );
}

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.round((Date.now() - then) / 60_000));
}

export function UsageTable({ initial }: { initial: UsageSnapshot | null }) {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(initial);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/usage", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as UsageSnapshot;
        if (alive && Array.isArray(data.accounts)) setSnapshot(data);
      } catch {
        // transient — keep showing the last good snapshot
      }
    };
    const id = setInterval(pull, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Guard the SSR/initial path too (not just the poll path): a non-array `accounts` from a
  // corrupted/hand-edited blob would otherwise throw in .map() and 500 the whole dashboard,
  // since there is no app/error.tsx boundary. sanitizeAccounts is the only writer today, so
  // this is defense-in-depth against a future second writer.
  const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : [];
  if (accounts.length === 0) return null;

  const ago = minutesAgo(snapshot?.receivedAt ?? null);
  const stale = ago != null && ago > 7; // pusher runs every 3 min; >7 min ⇒ likely stopped

  return (
    <section
      aria-label="Claude 계정 사용량"
      className="mb-8 overflow-hidden rounded-[1.4rem] border border-[#3a2c26] bg-[#171210]"
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="text-xs font-black tracking-[-0.01em] text-[#d8cfc6]">
          내 Claude 계정 리밋
        </div>
        <div className={`text-[0.68rem] font-semibold ${stale ? "text-[#ff8a70]" : "text-[#7d818a]"}`}>
          {ago == null ? "대기 중" : stale ? `${ago}분 전 · 갱신 지연?` : `${ago}분 전`}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-[0.68rem] font-bold uppercase tracking-wide text-[#7d818a]">
              <th className="px-3 py-2 text-left font-bold">계정</th>
              <th className="px-2 py-2 text-center font-bold">5시간</th>
              <th className="px-2 py-2 text-center font-bold">주간</th>
              <th className="px-2 py-2 text-center font-bold">Fable</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr
                key={a.number}
                className="border-t border-[#241c18]"
                style={a.active ? { backgroundColor: "#1d1613" } : undefined}
              >
                <td className="px-3 py-2 text-left">
                  <div className="flex items-center gap-1.5">
                    {a.active ? (
                      <span
                        aria-label="사용 중"
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#8fe0a6]"
                      />
                    ) : (
                      <span className="inline-block h-1.5 w-1.5 shrink-0" />
                    )}
                    <span className="text-[0.8rem] font-bold text-[#e9e3db]">#{a.number}</span>
                  </div>
                  <div className="ml-3 max-w-[9.5rem] truncate text-[0.68rem] font-medium text-[#8b8f96]">
                    {a.email}
                  </div>
                </td>
                <Cell w={a.fiveHour} />
                <Cell w={a.sevenDay} />
                <Cell w={a.fable} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 pt-1.5 pb-3 text-[0.62rem] font-medium leading-4 text-[#63666d]">
        숫자 = 사용률(높을수록 소진). 초록 여유 · 노랑 주의 · 빨강 거의 소진. 아래는 리셋까지 남은 시간.
      </div>
    </section>
  );
}
