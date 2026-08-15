"use client";

/**
 * Cuando falla el layout mismo — la base de datos caída, por ejemplo — no queda
 * ni la banda del 123 ni las tipografías: React reemplaza el documento entero.
 * Por eso esto trae su propio `html`, su propio `body` y sus propios estilos en
 * línea, sin depender de nada del sitio.
 *
 * Lo único que no puede faltar en una pantalla así es el 123.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          background: "#0f1211",
          color: "#e8ece9",
          fontFamily: "system-ui, sans-serif",
          lineHeight: 1.5,
        }}
      >
        <div style={{ padding: "1.25rem", display: "grid", gap: "1.25rem" }}>
          <p
            style={{
              background: "#8f2d21",
              color: "#fff",
              margin: 0,
              padding: "0.9rem",
              textAlign: "center",
              fontWeight: 600,
            }}
          >
            Si hay vidas en riesgo, marcá 123
          </p>

          <div
            style={{ border: "1px solid #2a302d", padding: "1rem", display: "grid", gap: "1rem" }}
          >
            <p style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700 }}>
              El buscador no está disponible ahora.
            </p>
            <p style={{ margin: 0, color: "#9aa5a0", fontSize: "0.95rem" }}>
              Estamos con una falla. Podés volver a cargar en un momento; mientras tanto, las
              fuentes que reunimos siguen publicando por su cuenta.
            </p>
            <button
              type="button"
              onClick={() => {
                reset();
                window.location.reload();
              }}
              style={{
                background: "#7fd7c4",
                color: "#0f1211",
                border: 0,
                padding: "1rem",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Actualizar la página
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
