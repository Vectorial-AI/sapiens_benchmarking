"use client";

import Link from "next/link";
import { Suspense } from "react";
import { markWizardRestorePending } from "@/lib/wizard-session";

function BenchmarkReport() {
  return (
    <div className="fixed inset-0 bg-[#FBFAF7]">
      <div className="pointer-events-none fixed top-0 left-0 z-50 flex h-[50px] items-center pl-5">
        <Link
          href="/"
          onClick={() => markWizardRestorePending()}
          className="pointer-events-auto text-[13px] font-medium text-accent hover:underline"
        >
          ← Back
        </Link>
      </div>
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
