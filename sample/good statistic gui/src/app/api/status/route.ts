import { getSeedState } from "@/lib/engine/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getSeedState();
  return Response.json({ ok: true, ...state });
}
