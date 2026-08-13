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
    <div className="wrap">
      <div className="disclaimer" style={{ marginTop: "2rem" }}>
        <h2 style={{ marginTop: 0 }}>Sitio deshabilitado por seguridad de datos</h2>
        <p>
          Se detectaron fuentes de <strong>datos de prueba</strong> habilitadas en un entorno de
          produccion, asi que este sitio no va a mostrar informacion hasta que se corrija. Mostrar
          un albergue o un punto de acopio inventado puede hacer que alguien se desplace a una
          direccion que no existe.
        </p>
        <p style={{ marginBottom: 0 }}>
          Si necesitas ayuda ahora: llama al <strong>123</strong>.
        </p>
      </div>

      <p className="text-muted text-[0.9rem] leading-relaxed">
        Para el equipo: fuentes de demostracion habilitadas — <code>{demoSources.join(", ")}</code>.
        Deshabilitarlas o borrarlas:
      </p>
      <pre
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "0.75rem",
          overflowX: "auto",
          fontSize: "0.85rem",
        }}
      >
        DELETE FROM sources WHERE slug LIKE &apos;demo-%&apos;;
      </pre>
    </div>
  );
}
