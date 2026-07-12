"use client";

import Link from "next/link";
import { Suspense } from "react";
import { markWizardRestorePending } from "@/lib/wizard-session";

function BenchmarkReport() {
  return (
    <div className="fixed inset-0 bg-[#FBFAF7]">
      {/* Floating back button — overlays the iframe without adding a second header */}
      <Link
        href="/"
        onClick={() => markWizardRestorePending()}
        className="fixed top-4 left-5 z-50 inline-flex items-center gap-1.5 rounded-full border border-[#E7E4DB] bg-[#FBFAF7]/90 px-3.5 py-1.5 text-[12px] font-semibold text-[#B23F17] shadow-sm backdrop-blur-sm hover:bg-white hover:border-[#E85D2C] transition-all"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back
      </Link>
      <iframe
        src="/sapiens-benchmark.html"
        title="SAPIENS 1.0 Benchmark Report"
        className="w-full h-full border-0"
      />
    </div>
  );
}

export default function BenchmarkPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted">Loading benchmark report…</div>}>
      <BenchmarkReport />
    </Suspense>
  );
}
