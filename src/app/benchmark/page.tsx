"use client";

import Link from "next/link";
import { Suspense } from "react";
import { markWizardRestorePending } from "@/lib/wizard-session";

function BenchmarkReport() {
  return (
    <div className="fixed inset-0 flex flex-col bg-[#FBFAF7]">
      <div className="shrink-0 flex items-center justify-between border-b border-[#E7E4DB] bg-[#FBFAF7]/90 px-4 py-2.5 backdrop-blur-sm">
        <Link
          href="/"
          onClick={() => markWizardRestorePending()}
          className="text-[13px] font-medium text-[#B23F17] hover:underline"
        >
          ← Back to benchmark wizard
        </Link>
        <span className="text-[12px] text-[#8B8980]">SAPIENS 1.0 · Benchmark report</span>
      </div>
      <iframe
        src="/sapiens-benchmark.html"
        title="SAPIENS 1.0 Benchmark Report"
        className="min-h-0 flex-1 w-full border-0"
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
