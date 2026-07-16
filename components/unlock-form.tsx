"use client";

import { type FormEvent, useState } from "react";

export function UnlockForm({ nextPath }: { nextPath: string }) {
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pin || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      if (!response.ok) {
        setError(response.status === 401 ? "PIN이 맞지 않아요. 다시 확인해 주세요." : "잠시 연결이 불안정해요. 다시 시도해 주세요.");
        return;
      }

      window.location.assign(nextPath);
    } catch {
      setError("네트워크 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-9">
      <label htmlFor="pin" className="mb-2 block text-sm font-extrabold text-[#d6d4cf]">
        개인 PIN
      </label>
      <input
        id="pin"
        name="pin"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        autoFocus
        value={pin}
        onChange={(event) => {
          setPin(event.target.value);
          if (error) setError("");
        }}
        placeholder="PIN 입력"
        aria-describedby={error ? "pin-error" : "pin-help"}
        className="min-h-16 w-full rounded-2xl border border-[#353941] bg-[#0c0e12] px-5 text-center text-2xl font-black tracking-[0.25em] text-white placeholder:text-base placeholder:font-semibold placeholder:tracking-normal placeholder:text-[#62656c] focus:border-[#ff5a36] focus:outline-none"
      />
      <p id="pin-help" className="mt-3 text-xs font-medium leading-5 text-[#777a81]">
        한 번 열면 이 기기에서 30일 동안 유지됩니다.
      </p>

      {error ? (
        <p id="pin-error" role="alert" className="mt-4 rounded-xl border border-[#58302a] bg-[#201312] px-4 py-3 text-sm font-bold text-[#ff9a83]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!pin || submitting}
        className="mt-6 flex min-h-16 w-full items-center justify-center rounded-2xl bg-[#ff5a36] px-5 text-lg font-black text-white transition active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {submitting ? "여는 중…" : "결정함 열기"}
      </button>
    </form>
  );
}
