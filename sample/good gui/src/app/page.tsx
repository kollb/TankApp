import { getStations, getSystemHealth } from "@/lib/data";
import { TankAppDashboard } from "@/components/TankAppDashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [stations, health] = await Promise.all([
    getStations(),
    getSystemHealth(),
  ]);

  return <TankAppDashboard initialStations={stations} initialHealth={health} />;
}
