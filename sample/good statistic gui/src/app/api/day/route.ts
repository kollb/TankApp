import { loadDaySeries } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const station = url.searchParams.get("station") ?? "";
  const day = url.searchParams.get("day") ?? "";
  if (!station || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ ok: false, error: "station & day (YYYY-MM-DD) erforderlich" }, { status: 400 });
  }
  try {
    const pts = await loadDaySeries(station, day);
    return Response.json({ ok: true, station, day, points: pts });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
