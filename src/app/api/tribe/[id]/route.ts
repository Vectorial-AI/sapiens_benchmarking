import { NextResponse } from "next/server";
import { getCatalogTribe } from "@/lib/master";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tribe = getCatalogTribe(id);
  if (!tribe) {
    return NextResponse.json({ error: "Tribe not found" }, { status: 404 });
  }
  return NextResponse.json({ tribe });
}
