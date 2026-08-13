import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import Link from "next/link";

import { DataIntegrityBlock } from "@/components/DataIntegrityBlock";
import { checkProductionDataIntegrity } from "@/lib/guards";

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
  const integrity = await checkProductionDataIntegrity();

  return (
    <html lang="es-CO" className={`${body.variable} ${display.variable} ${data.variable}`}>
      <body className="flex min-h-dvh flex-col">
        {/*
          Always visible, and never dependent on a query or on the model. Red
          appears here and nowhere else on the site: if it appears twice it
          stops meaning "this is the one that saves your life".
        */}
        <p className="border-danger-border bg-danger-bg text-danger-text border-b px-4 py-2 text-center text-[0.8rem] leading-snug">
          Emergencia con riesgo de vida:{" "}
          <strong className="font-mono text-[0.95rem] font-medium tracking-tight">123</strong>. Este
          sitio no atiende emergencias ni despacha ayuda.
        </p>

        <header className="border-rule border-b">
          <div className="mx-auto flex w-full max-w-[34rem] items-center justify-between gap-4 px-5 py-3">
            <Link href="/" className="label !text-[0.82rem] hover:opacity-70">
              Buscador de ayuda
            </Link>
            <nav className="text-muted flex gap-4">
              <Link href="/" className="label hover:text-text">
                Preguntar
              </Link>
              <Link href="/fuentes" className="label hover:text-text">
                Fuentes
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col px-5 py-5">
          {integrity.ok ? children : <DataIntegrityBlock demoSources={integrity.demoSources} />}
        </main>

        <footer className="border-rule text-muted border-t">
          <div className="mx-auto w-full max-w-[34rem] px-5 py-4 text-[0.78rem] leading-relaxed">
            Proyecto comunitario. No reemplaza al 123, la UNGRD, la Cruz Roja ni a las autoridades
            municipales. No recibe reportes nuevos: cada resultado enlaza al sitio original, donde
            se puede confirmar y actualizar.
          </div>
        </footer>
      </body>
    </html>
  );
}
