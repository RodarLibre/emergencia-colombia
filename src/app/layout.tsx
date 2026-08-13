import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import Link from "next/link";

import { DataIntegrityBlock } from "@/components/DataIntegrityBlock";
import { Nav } from "@/components/Nav";
import { THEME_INIT_SCRIPT, ThemeToggle } from "@/components/ThemeToggle";
import { checkProductionDataIntegrity } from "@/lib/guards";
import { getCatalogStats } from "@/lib/search";

import "./globals.css";

/*
 * IBM Plex, in three roles. Self-hosted by next/font, so there is no CDN
 * request at run time and no silent fallback to a system face.
 *
 * Chosen because Plex was drawn as an institutional voice, which is what this
 * is: a public instrument that quotes other institutions and has to look like
 * it takes that seriously. Condensed carries signage, Sans carries reading,
 * Mono carries provenance — who said it and when.
 */
const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--ff-body",
  display: "swap",
});

const display = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--ff-display",
  display: "swap",
});

const data = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--ff-data",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Buscador de ayuda - Terremoto Colombia",
  description:
    "Una sola pregunta para buscar puntos de acopio, albergues y comunicados oficiales publicados en varios sitios de la emergencia.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Integrity wall: if test data is enabled in production, no record is served.
  // See src/lib/guards.ts.
  const [integrity, stats] = await Promise.all([
    checkProductionDataIntegrity(),
    getCatalogStats(),
  ]);

  return (
    <html
      lang="es-CO"
      className={`${body.variable} ${display.variable} ${data.variable}`}
      // The theme-init script below sets `data-theme` on this element before
      // hydration, from localStorage — something the server can't know. That
      // mismatch is the point, not a bug, so React shouldn't warn about it.
      suppressHydrationWarning
    >
      <body className="bg-desk flex min-h-dvh flex-col">
        {/*
          Applies a remembered light/dark choice before first paint, so it
          never flashes the device's own preference first. A plain SSR'd tag
          rather than `next/script`: this needs to run synchronously as the
          HTML streams in, before hydration — exactly what a script placed
          directly in the markup already does, with no framework machinery
          between the server output and the browser executing it.
        */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/*
          A single sheet, bordered like a printed instrument rather than a
          floating card. On a phone the frame IS the viewport, so the border
          and the desk behind it never show; on anything wider, the site reads
          as one bounded object sitting on its own ground.
        */}
        <div className="border-frame bg-bg mx-auto flex w-full max-w-[34rem] flex-1 flex-col md:my-8 md:min-h-0 md:border-x md:border-y">
          {/*
            Always visible, and never dependent on a query or on the model. A
            solid ground rather than a tinted strip: this is the one band that
            has to read before anything else does. Red appears here and
            nowhere else but the scope notices about a life or a person's
            safety — if it meant less than that too, it would mean less here.
          */}
          <p className="bg-danger-solid-bg text-danger-solid-fg px-4 py-2.5 text-center text-[0.85rem] leading-snug font-medium">
            Si hay vidas en riesgo, marca:{" "}
            <strong className="font-mono text-[1.05rem] font-medium tracking-tight">123</strong>
          </p>

          <header className="bg-official-bg text-official-text flex items-center justify-between gap-3 px-5 py-2.5">
            <Link href="/" className="label flex items-center gap-1.5 !text-[0.82rem] hover:opacity-80">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3.5 10.5 12 3.5l8.5 7" />
                <path d="M5.5 9v10.5a1 1 0 0 0 1 1H9.5a1 1 0 0 0 1-1V15h3v4.5a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V9" />
              </svg>
              Buscador de ayuda
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Nav sourceCount={stats.sourceCount} />
            </div>
          </header>

          {/*
            No horizontal padding here: the search box and the source bar on
            the home screen bleed edge to edge and stick to the top on
            scroll, which a padded ancestor would clip. Every other page adds
            its own inset.
          */}
          <main className="flex flex-1 flex-col py-5">
            {integrity.ok ? (
              children
            ) : (
              <div className="px-5">
                <DataIntegrityBlock demoSources={integrity.demoSources} />
              </div>
            )}
          </main>

          <footer className="border-rule text-muted border-t">
            <div className="px-5 py-4 text-[0.78rem] leading-relaxed">
              Proyecto comunitario, sin relación oficial con el 123, la UNGRD ni la Cruz Roja.
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
