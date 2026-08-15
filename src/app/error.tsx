"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Lo que ve alguien cuando la pantalla se rompe.
 *
 * Antes no existía: React mostraba su pantalla genérica y la persona quedaba
 * sin nada que tocar. En un celular nadie sabe que hay que recargar —no hay
 * botón de recargar a la vista, y "deslizar hacia abajo" es un gesto que no
 * todo el mundo conoce—, así que simplemente se van.
 *
 * Tres cosas, en este orden: el 123 por si la emergencia es ahora, un botón de
 * verdad para reintentar, y la salida a las fuentes para que nadie quede
 * atrapado acá si esto sigue fallando.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // Sin la pregunta ni datos de la persona: solo que hubo una falla.
    console.error("Fallo en la interfaz:", error.message);
  }, [error]);

  return (
    <div className="flex flex-col gap-5 px-5 py-6">
      <p className="bg-danger-solid-bg text-danger-solid-fg flex min-h-[3rem] items-center justify-center px-3 text-center text-[0.95rem] font-semibold">
        Si hay vidas en riesgo, marcá 123
      </p>

      <div className="border-rule flex flex-col gap-3 border p-4">
        <p className="font-display text-[1.15rem] leading-tight font-bold">
          Se rompió algo de nuestro lado.
        </p>
        <p className="text-muted text-[0.92rem] leading-relaxed">
          No fue tu pregunta. Volvé a cargar y probá otra vez.
        </p>

        <button
          type="button"
          onClick={() => {
            // reset() reintenta sin recargar; si el fallo venía del servidor
            // viejo tras un despliegue, hace falta traer la página de nuevo.
            reset();
            window.location.reload();
          }}
          className="bg-accent text-bg flex min-h-[3.25rem] items-center justify-center px-3 text-[0.98rem] font-semibold"
        >
          Actualizar la página
        </button>

        <Link
          href="/fuentes"
          className="border-rule hover:border-accent flex min-h-[3rem] items-center justify-between gap-3 border px-3 text-[0.92rem] font-semibold"
        >
          <span>Entrar directo a las fuentes</span>
          <span aria-hidden="true" className="text-accent shrink-0">
            →
          </span>
        </Link>
      </div>
    </div>
  );
}
