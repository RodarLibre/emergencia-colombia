/**
 * Blocking page. Shown instead of the site when demo sources are detected
 * enabled in production.
 *
 * Deliberately a wall and not a notice: as long as made-up data is enabled,
 * no record gets served. The only thing shown is the emergency number, which
 * is always true.
 */
export function DataIntegrityBlock({ demoSources }: { demoSources: readonly string[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-danger-solid-bg text-danger-solid-fg flex flex-col gap-3 p-4">
        <h2 className="font-display text-[1.4rem] leading-tight font-bold">
          Apagamos el sitio a propósito.
        </h2>
        <p className="text-[0.92rem] leading-relaxed">
          Hay datos de prueba activos. Antes de mandarte a una dirección que no existe, preferimos
          no mostrar nada.
        </p>
        <a
          href="tel:123"
          className="bg-danger-solid-fg text-danger-solid-bg font-display flex min-h-[3.1rem] items-center justify-center text-[0.95rem] font-bold tracking-wide uppercase"
        >
          Llamar al 123
        </a>
      </div>

      <p className="stamp text-muted">
        Equipo: fuentes de demostración habilitadas — <code>{demoSources.join(", ")}</code>.
      </p>
      <pre className="border-border bg-surface stamp overflow-x-auto border p-3">
        DELETE FROM sources WHERE slug LIKE &apos;demo-%&apos;;
      </pre>
    </div>
  );
}
