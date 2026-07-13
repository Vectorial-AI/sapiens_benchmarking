"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { markWizardRestorePending } from "@/lib/wizard-session";

function BenchmarkReport() {
  const [iframeSrc, setIframeSrc] = useState("/sapiens-benchmark.html");

  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash;
      setIframeSrc(`/sapiens-benchmark.html${hash || ""}`);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

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
        key={iframeSrc}
        src={iframeSrc}
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
