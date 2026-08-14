import Link from "next/link";

// Como el resto de las rutas: el layout consulta la base y el prerenderizado
// no puede alcanzarla durante el build.
export const dynamic = "force-dynamic";

/**
 * Not found.
 *
 * Next's default is an English page on a Spanish-language emergency site, and
 * a dead end. This one is in the site's language, reframes absence as
 * information rather than an error — a withdrawn notice means nobody sustains
 * it anymore, which is itself worth knowing — and offers the two ways out
 * that exist: ask again, or go to the sources and read them directly.
 */
export default function NotFound() {
  return (
    <div className="flex flex-col gap-4 px-5">
      <h2 className="font-display text-[1.5rem] leading-[1.08] font-bold">
        Este aviso ya no está.
      </h2>
      <p className="text-muted text-[0.92rem] leading-relaxed">
        Puede que la fuente lo haya retirado. Eso también es información: significa que ya no lo
        sostiene nadie.
      </p>
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="border-official-bg bg-accent-soft flex min-h-[3rem] items-center justify-between gap-3 border px-3 text-[0.95rem] font-semibold"
        >
          Hacer una pregunta
          <span aria-hidden="true">→</span>
        </Link>
        <Link
          href="/fuentes"
          className="border-rule hover:border-accent flex min-h-[3rem] items-center justify-between gap-3 border px-3 text-[0.95rem]"
        >
          Ver las fuentes conectadas
          <span aria-hidden="true" className="text-accent">
            →
          </span>
        </Link>
      </div>
    </div>
  );
}
