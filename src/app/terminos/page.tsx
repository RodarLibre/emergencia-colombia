import Link from "next/link";

import type { Metadata } from "next";

/**
 * Terms and limitation of liability.
 *
 * Static on purpose: no database, no props, nothing that can fail. This page
 * has to render when the rest of the site cannot.
 *
 * It says nothing the product does not already say — the source stamp on every
 * card, the "stale" note, the demo-data wall. What it adds is one home for it,
 * so somebody deciding whether to drive somewhere can read the whole caveat in
 * one place instead of inferring it from a timestamp.
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
  title: "Términos de uso",
  description: "Qué es esta información, de dónde sale y hasta dónde llega.",
};

export default function TerminosPage() {
  return (
    <div className="flex max-w-[65ch] flex-col gap-5 px-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-[1.6rem] leading-[1.05] font-bold text-balance">
          Términos de uso
        </h2>
        <p className="text-[0.95rem] leading-relaxed">
          Este sitio reúne información publicada por otros. No la generamos, no la verificamos en
          terreno y no reemplaza a ningún canal oficial.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">En una emergencia, llamá al 123</h3>
        <p className="text-[0.95rem] leading-relaxed">
          Si hay riesgo para la vida, el 123 es el número. Este sitio sirve para ubicar dónde hay
          albergues, acopios o puntos de servicio; no despacha ayuda ni recibe reportes.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">De dónde sale la información</h3>
        <p className="text-[0.95rem] leading-relaxed">
          De sitios públicos de comunidades, organizaciones y entidades. Cada resultado dice de qué
          fuente salió, cuándo se leyó por última vez y lleva el enlace al original. La lista
          completa está en{" "}
          <Link href="/fuentes" className="hover:text-accent underline underline-offset-2">
            Fuentes
          </Link>
          .
        </p>
        <p className="text-[0.95rem] leading-relaxed">
          Cuando dos fuentes se contradicen, mostramos las dos. No unificamos ni elegimos por vos.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">Puede estar desactualizada</h3>
        <p className="text-[0.95rem] leading-relaxed">
          Leemos las fuentes cada pocos minutos, pero un albergue puede llenarse, un acopio puede
          cerrar y una fuente puede tardar en avisarlo. La marca de tiempo de cada ficha dice qué
          tan vieja es esa lectura.
        </p>
        <p className="text-[0.95rem] leading-relaxed">
          <strong>Confirmá antes de viajar</strong>, sobre todo si el viaje es largo, si vas con
          niños o personas mayores, o si estás llevando algo pesado. Llamá al lugar o revisá el
          enlace de la fuente.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">
          Hasta dónde llega nuestra responsabilidad
        </h3>
        <p className="text-[0.95rem] leading-relaxed">
          Este es un proyecto comunitario, sin ánimo de lucro y sin relación oficial con el 123, la
          UNGRD ni la Cruz Roja. Hacemos el mejor esfuerzo para que lo que ves refleje lo que la
          fuente publicó, pero no garantizamos que la información sea exacta, esté completa ni siga
          vigente, y no respondemos por decisiones tomadas a partir de ella.
        </p>
        <p className="text-[0.95rem] leading-relaxed">
          Si algo que ves acá está mal, lo más útil es avisarle también a la fuente original:
          nosotros mostramos lo que ella publica.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">Qué buscás acá no se guarda</h3>
        <p className="text-[0.95rem] leading-relaxed">
          No guardamos tu dirección IP y no hay cuentas ni perfiles. Se usa una cookie técnica, sin
          nombre ni datos personales, sólo para evitar que una sola persona sature el sitio.
        </p>
        <p className="text-[0.95rem] leading-relaxed">
          Las preguntas que escribís en el buscador tampoco se guardan. La única excepción es si
          marcás vos mismo la casilla al enviarnos feedback sobre una respuesta: ahí sí guardamos
          esa pregunta, y sólo por 30 días. Si no marcás nada, no queda nada.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-[1.1rem] font-bold">Contacto</h3>
        <p className="text-[0.95rem] leading-relaxed">
          Para correcciones o retiros de información, lo más rápido es abrir un reporte en{" "}
          <a
            href="https://github.com/RodarLibre/emergencia-colombia/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-accent underline underline-offset-2"
          >
            el repositorio
          </a>
          . Para algo que no querés hacer público, escribinos a{" "}
          <a
            href="mailto:hola@rodarlibre.co"
            className="hover:text-accent underline underline-offset-2"
          >
            hola@rodarlibre.co
          </a>
          .
        </p>
      </section>

      <p className="stamp text-muted">Última actualización: 2026-08-14</p>
    </div>
  );
}
