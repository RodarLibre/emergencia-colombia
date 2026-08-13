"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The masthead's other half: a single toggle, not two links.
 *
 * On every page but the sources directory it offers a way there, badged with
 * how many sources are actually connected. On the sources page itself it
 * offers the way back. One control, so the header never has to explain which
 * of two links is "where you already are".
 */
export function Nav({ sourceCount }: { sourceCount: number }) {
  const pathname = usePathname();
  const onSources = pathname === "/fuentes";

  return (
    <Link
      href={onSources ? "/" : "/fuentes"}
      className="label border-official-text/40 hover:bg-black/10 shrink-0 border px-3 py-2.5"
    >
      {onSources ? "Preguntar" : `Fuentes · ${sourceCount}`}
    </Link>
  );
}
