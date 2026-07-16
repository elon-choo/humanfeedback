import type { Metadata } from "next";

import { UnlockForm } from "@/components/unlock-form";
import {
  APP_SHORT_BRAND,
  OWNER_UNLOCK_GREETING,
} from "@/lib/public-config";

export const metadata: Metadata = {
  title: "잠금 해제",
};

type UnlockPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

function safeNext(value: string | string[] | undefined) {
  const path = Array.isArray(value) ? value[0] : value;
  return path && path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export default async function UnlockPage({ searchParams }: UnlockPageProps) {
  const query = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-[14px] bg-[#ff5a36] text-xl font-black text-white" aria-hidden="true">
            함
          </div>
          <div>
            <div className="text-sm font-black tracking-[-0.01em]">{APP_SHORT_BRAND}</div>
            <div className="mt-0.5 text-[0.68rem] font-bold uppercase tracking-[0.13em] text-[#777a81]">Private inbox</div>
          </div>
        </div>

        <div className="surface p-6 sm:p-8">
          <div className="grid h-12 w-12 place-items-center rounded-2xl border border-[#363a42] bg-[#1a1d23]" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="10" width="14" height="10" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="mt-6 text-[1.75rem] font-black leading-tight tracking-[-0.045em]">
            {OWNER_UNLOCK_GREETING}
          </h1>
          <p className="mt-3 text-sm font-medium leading-6 text-[#96999f]">중요한 결정이 담긴 개인 공간입니다.</p>
          <UnlockForm nextPath={safeNext(query.next)} />
        </div>
      </section>
    </main>
  );
}
