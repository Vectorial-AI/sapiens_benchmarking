import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/master";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ tribes: getCatalog() });
}
