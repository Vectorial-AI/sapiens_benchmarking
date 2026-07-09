"use client";

import type { ReactNode } from "react";

export function Label({ children }: { children: ReactNode }) {
  return (
    <label className="block text-[13px] font-medium text-muted mb-2">
      {children}
    </label>
  );
}

export type Tone = "real" | "persona" | "history" | "sapiens";

export const TONE_BG: Record<Tone, string> = {
  real: "bg-real",
  persona: "bg-persona",
  history: "bg-history",
  sapiens: "bg-accent",
};

export function Dot({ tone }: { tone: Tone }) {
  return (
    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_BG[tone]}`} />
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      width="16"
      height="16"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return null;
  const full = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-1 text-amber-500">
      <span className="text-sm tracking-tight">
        {"★".repeat(full)}
        <span className="text-border-strong">{"★".repeat(5 - full)}</span>
      </span>
      <span className="text-xs text-muted">{rating.toFixed(1)}</span>
    </span>
  );
}

export function ModelSelect({
  value,
  onChange,
  models,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  models: string[];
  loading?: boolean;
}) {
  return (
    <select
      className="select w-full px-3 py-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={loading}
    >
      {loading && <option>Loading models…</option>}
      {models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}
