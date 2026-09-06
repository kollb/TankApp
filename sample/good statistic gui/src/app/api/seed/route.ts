import { seedDatabase } from "@/lib/engine/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  try {
    const result = await seedDatabase(force);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("seed failed", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
