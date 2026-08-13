import { Chat } from "@/components/Chat";

/**
 * Never prerendered. Answers depend on the database and the moment, and cached
 * HTML from an emergency catalog is old information presented as current.
 */
export const dynamic = "force-dynamic";

export default function Home() {
  return <Chat />;
}
