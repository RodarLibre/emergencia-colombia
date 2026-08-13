import Link from "next/link";

/**
 * Not found.
 *
 * Next's default is an English page on a Spanish-language emergency site, and
 * a dead end. This one is in the site's language and offers the two ways out
 * that exist: ask again, or go to the sources and read them directly.
 */
export default function NotFound() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-[1.5rem] leading-tight font-semibold">
        Esta página no existe.
      </h2>
      <p className="text-muted text-[0.95rem] leading-relaxed">
        Puede que el registro haya sido retirado por su fuente, o que el enlace esté incompleto.
      </p>
      <ul className="border-rule divide-border flex flex-col divide-y border-y">
        <li>
          <Link href="/" className="hover:text-accent flex justify-between gap-3 py-2.5">
            Hacer una pregunta
            <span aria-hidden="true" className="text-muted">
              →
            </span>
          </Link>
        </li>
        <li>
          <Link href="/fuentes" className="hover:text-accent flex justify-between gap-3 py-2.5">
            Ver las fuentes conectadas
            <span aria-hidden="true" className="text-muted">
              →
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
