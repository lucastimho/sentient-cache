import { HudConsole } from "@/components/HudConsole";

// Page is a React Server Component — ships the structural shell inline, then
// HudConsole hydrates on the client for the high-frequency galaxy, latency
// sparkline, and write-behind queue.
export default function Page() {
  return <HudConsole />;
}
