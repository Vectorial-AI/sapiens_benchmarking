import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  COOKIE_NAME,
  isAuthEnabled,
  isValidAuthToken,
  sanitizeNextPath,
} from "@/lib/auth";
import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next);
  const authEnabled = isAuthEnabled();

  if (authEnabled) {
    const jar = await cookies();
    if (await isValidAuthToken(jar.get(COOKIE_NAME)?.value)) {
      redirect(next);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Image
            src="/vectorial-logo.png"
            alt="Vectorial"
            width={163}
            height={22}
            className="h-[22px] w-auto"
            priority
          />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          SAPIENS Benchmark
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Sign in to open the interactive wizard. The public benchmark report stays available
          without a password.
        </p>

        {authEnabled ? (
          <LoginForm next={next} />
        ) : (
          <p className="mt-8 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
            Auth is not configured. Set <code className="font-mono text-foreground">SITE_PASSWORD</code>{" "}
            to enable the login gate.
          </p>
        )}

        <p className="mt-8 text-sm text-muted">
          Looking for the report?{" "}
          <Link href="/benchmark" className="font-medium text-accent hover:text-accent-2">
            View benchmark →
          </Link>
        </p>
      </div>
    </main>
  );
}
