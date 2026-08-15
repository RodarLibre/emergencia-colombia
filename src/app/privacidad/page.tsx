import Link from "next/link";

import type { Metadata } from "next";

import { RETENTION_DAYS } from "@/lib/feedback";

/**
 * Privacy notice (aviso de privacidad, Ley 1581).
 *
 * Static, like `/terminos`: no database, nothing that can fail. The consent
 * checkbox links here, so this page has to render for that tick to mean
 * anything.
 *
 * `RETENTION_DAYS` is read from the code rather than restated, so the window
 * promised here cannot drift away from the sweep that enforces it. A notice
 * that quietly stops being true is worse than no notice.
 */

/**
 * Rendered per request, like every other page here.
 *
 * Not because this page has anything dynamic on it — it does not — but because
 * the root layout reads the catalog to draw the source count and the integrity
 * wall. Prerendering this page at build time renders that layout too, so the
 * build opens a database connection, and the build machine has none: the deploy
 * fails at `pnpm build` inside Docker with ECONNREFUSED, while passing on any
 * laptop that happens to have Postgres up.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacidad",
  description: "Qué datos guardamos, por cuánto tiempo y cómo pedir que los borremos.",
};

export default function PrivacidadPage() {
  return (
    <div className="flex max-w-[65ch] flex-col gap-5 px-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-[1.6rem] leading-[1.05] font-bold text-balance">
          Cómo tratamos estos datos
        </h2>
        <p className="text-[0.95rem] leading-relaxed">
          Este sitio está hecho para que puedas buscar sin identificarte. No hay cuentas, no
          guardamos tu dirección IP y no llevamos un historial de lo que buscás.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">Quién responde por esto</h3>
        <p className="text-[0.95rem] leading-relaxed">
          Rodar Libre, responsable del tratamiento.{" "}
          <a
            href="mailto:hola@rodarlibre.co"
            className="hover:text-accent underline underline-offset-2"
          >
            hola@rodarlibre.co
          </a>
          .
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">Qué guardamos siempre</h3>
        <p className="text-[0.95rem] leading-relaxed">
          Una cookie técnica con un número aleatorio, sin tu nombre ni ningún dato tuyo. Sirve para
          una sola cosa: que una persona sola no sature el buscador. Dura una semana.
        </p>
        <p className="text-[0.95rem] leading-relaxed">
          Si votás si una respuesta te sirvió, guardamos el voto, los motivos que marques de la
          lista, y datos técnicos de esa búsqueda: qué categorías se buscaron, qué municipio, qué
          resultados salieron y si la pregunta la interpretó el modelo o el vocabulario.{" "}
          <strong>Nada de eso te identifica.</strong>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">Qué guardamos sólo si vos lo pedís</h3>
        <p className="text-[0.95rem] leading-relaxed">
          El texto de tu pregunta y tu comentario. Únicamente si marcás la casilla al enviarnos
          feedback sobre una respuesta que no te sirvió. Si no la marcás, no se guardan: ni la
          pregunta, ni el comentario.
        </p>
        <p className="text-[0.95rem] leading-relaxed">
          Para qué: para entender por qué la búsqueda falló. Casi siempre es una palabra que la
          lista no conocía —alguien escribe &laquo;remesa&raquo; donde nosotros teníamos
          &laquo;mercado&raquo;— y sin las palabras exactas no hay forma de arreglarlo.
        </p>
        <p className="text-[0.95rem] leading-relaxed">
          <strong>Se borran solos a los {RETENTION_DAYS} días.</strong> No hace falta que pidas
          nada; pasado ese plazo el texto desaparece y queda sólo el voto, que no dice quién sos.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">Tus derechos</h3>
        <p className="text-[0.95rem] leading-relaxed">
          Podés pedir que te contemos qué guardamos, que lo corrijamos, que lo borremos antes de los{" "}
          {RETENTION_DAYS} días, o retirar la autorización que diste. Escribinos a{" "}
          <a
            href="mailto:hola@rodarlibre.co"
            className="hover:text-accent underline underline-offset-2"
          >
            hola@rodarlibre.co
          </a>
          .
        </p>
        <p className="text-[0.95rem] leading-relaxed">
          <strong>Decinos el código del caso.</strong> Debajo de cada respuesta aparece algo como{" "}
          <span className="stamp">4D2C0B95</span>. Como no hay cuentas, ese código es lo único que
          nos permite encontrar tu registro y ningún otro. Sin él no podemos saber cuál borrar.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">Quién más ve tu pregunta</h3>
        <p className="text-[0.95rem] leading-relaxed">
          Para entender qué estás buscando, tu pregunta se le envía a un servicio de inferencia
          (DigitalOcean Gradient), que la convierte en filtros de búsqueda. Ese servicio nunca ve
          los registros ni escribe la respuesta: eso lo arma nuestro código con los datos de las
          fuentes. Acá no queda guardada, y del lado del proveedor rige su propia política, que no
          controlamos.
        </p>
        <p className="text-[0.95rem] leading-relaxed">
          El feedback que nos dejás no sale de nuestra base. No se comparte, no se vende y no se
          publica: los reportes que hacemos públicos llevan sólo totales.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">Qué no hacemos</h3>
        <p className="text-[0.95rem] leading-relaxed">
          No guardamos direcciones IP. No usamos analítica de terceros ni cookies de publicidad. No
          cruzamos lo que buscás con ninguna otra base. No hay perfiles.
        </p>
      </section>

      <p className="text-[0.95rem] leading-relaxed">
        Sobre qué es esta información y hasta dónde llega, mirá los{" "}
        <Link href="/terminos" className="hover:text-accent underline underline-offset-2">
          términos de uso
        </Link>
        .
      </p>

      <p className="stamp text-muted">Última actualización: 2026-08-15</p>
    </div>
  );
}
