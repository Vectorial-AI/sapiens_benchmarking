"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  COOKIE_NAME,
  createAuthToken,
  isAuthEnabled,
  sanitizeNextPath,
  verifyPassword,
} from "@/lib/auth";

export type LoginState = {
  error?: string;
};

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const password = String(formData.get("password") ?? "");
  const next = sanitizeNextPath(String(formData.get("next") ?? "/"));

  if (!(await verifyPassword(password))) {
    return { error: "Incorrect password." };
  }

  const token = await createAuthToken();
  if (!token) {
    return { error: "Auth is not configured." };
  }

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect(next);
}
