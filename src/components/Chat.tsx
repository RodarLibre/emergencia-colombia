"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  ask,
  getStats,
  rateAnswer,
  type AppliedFilters,
  type FeedbackHandle,
  type FeedbackReason,
} from "@/app/actions";
import { ResultCard } from "@/components/ResultCard";
import type { Answer, AnswerNote } from "@/lib/answer";
import { relativeTime } from "@/lib/format";
import type { OutOfScopeReason } from "@/lib/intent";
import { findPossibleSameplace, statusesDisagree } from "@/lib/relate";
import type { CatalogStats } from "@/lib/search";
import { joinInSpanish } from "@/lib/spanish";
import {
  CATEGORY_LABELS,
  OPERATING_ADMIN1_NAMES,
  RECORD_TYPE_LABELS,
  type Category,
  type RecordTypeV1,
} from "@/lib/vocab";

/**
 * The search screen.
 *
 * One box, fixed at the top, one current answer below it — not a
 * conversation. Nothing about a question is kept once the next one replaces
 * it: no history, because a question can contain a name, an address or a
 * health detail, and there is nothing here to scroll back through anyway.
 * The reply is composed by code from real records — see `composeAnswer`. The
 * model only ever turns the question into filters and never sees a record,
 * so nothing here can invent an address.
 */

/**
 * Ejemplos repartidos por departamento, no todos del Valle: quien entra desde
 * Risaralda o Quindío tiene que ver su ciudad acá para saber que lo cubrimos.
 *
 * Cada uno se eligió porque HOY devuelve resultados. Un ejemplo que no
 * encuentra nada es peor que no ponerlo: enseña que el sitio no sirve.
 */
const SUGGESTIONS = [
  "Albergues en Pereira",
  "¿Dónde puedo llevar agua en Palmira?",
  "¿Dónde puedo ayudar en Armenia?",
  "Puntos de acopio en Manizales",
  "Ayuda en Roldanillo",
  "¿Quién recibe insumos médicos?",
  "¿Hubo réplicas anoche?",
];

/** Marcas de una sola recarga tras un despliegue. Ver `run`. */
const RECARGA = "ayuda:recarga";
const PENDIENTE = "ayuda:pregunta-pendiente";

type View =
  | { kind: "home" }
  | {
      kind: "answer";
      question: string;
      answer: Answer;
      filters: AppliedFilters;
      feedback: FeedbackHandle | null;
    }
  | { kind: "scope"; question: string; reason: OutOfScopeReason }
  | { kind: "coverage"; question: string; municipality: string; department: string }
  | { kind: "error" };

const NOTE_TEXT: Partial<Record<AnswerNote, { lead: string; rest: string }>> = {
  // Nadie se queda sin respuesta porque una palabra no estuviera en una lista,
  // pero tampoco se finge una certeza que no hay.
  guessed: {
    lead: "Interpreté lo que buscabas.",
    rest: "Si no era eso, escribilo de otra forma o con otras palabras.",
  },
  rate_limited: {
    lead: "Busqué tu texto tal cual.",
    rest: "Se acabó el cupo de preguntas interpretadas de esta hora; los resultados siguen siendo reales.",
  },
  fallback: {
    lead: "Busqué tu texto tal cual.",
    rest: "No pude interpretar la pregunta, pero busqué tus palabras en las fuentes conectadas.",
  },
  busy: {
    lead: "Respondiendo sin interpretar.",
    rest: "Hay mucha gente preguntando ahora mismo.",
  },
};

/** Escapes regex metacharacters so a municipality name can be dropped into a `RegExp` safely. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes a municipality name (and the preposition in front of it) from a question, for the "search the whole department" retry. */
function withoutMunicipality(question: string, municipality: string): string {
  const name = escapeRegExp(municipality);
  return question
    .replace(new RegExp(`\\b(en|de|del|para|hacia)\\s+${name}\\b`, "gi"), "")
    .replace(new RegExp(`\\b${name}\\b`, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function Chat() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [draft, setDraft] = useState("");
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [pending, startTransition] = useTransition();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pendiente = sessionStorage.getItem(PENDIENTE);
    if (pendiente) {
      sessionStorage.removeItem(PENDIENTE);
      run(pendiente);
    }
    // Solo al montar: es la vuelta de la recarga, no algo que se repita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    getStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // A new search replaces the screen below the box; without this, someone who
  // had scrolled down into a long result list stays scrolled down, now facing
  // the middle of an unrelated answer.
  useEffect(() => {
    if (pending) contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pending]);

  function run(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    setDraft(text);

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof ask>>;
      try {
        result = await ask(text);
      } catch {
        // Un despliegue reemplaza el contenedor y cambia el build id, asi que
        // una pestaña abierta desde antes llama a una accion de servidor que ya
        // no existe. Sin esto la pantalla se rompe y hay que recargar a mano.
        //
        // Se recarga una sola vez y se deja la pregunta guardada para
        // repetirla: si el fallo es otro, el segundo intento muestra el aviso
        // en lugar de entrar en bucle de recargas.
        if (!sessionStorage.getItem(RECARGA)) {
          sessionStorage.setItem(RECARGA, "1");
          sessionStorage.setItem(PENDIENTE, text);
          window.location.reload();
          return;
        }
        setView({ kind: "error" });
        return;
      }
      sessionStorage.removeItem(RECARGA);
      setView(
        result.kind === "out_of_scope"
          ? { kind: "scope", question: text, reason: result.reason }
          : result.kind === "out_of_coverage"
            ? {
                kind: "coverage",
                question: text,
                municipality: result.municipality,
                department: result.department,
              }
            : {
                kind: "answer",
                question: text,
                answer: result.answer,
                filters: result.filters,
                feedback: result.feedback,
              },
      );
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-bg sticky top-0 z-10 flex flex-col">
        <SearchBox
          expanded={view.kind === "home"}
          draft={draft}
          setDraft={setDraft}
          onSubmit={run}
          pending={pending}
          sourceCount={stats?.sourceCount ?? null}
        />
        <StatusStrip view={view} stats={stats} />
      </div>

      <div ref={contentRef} className="flex flex-1 flex-col gap-5 px-5 py-4">
        {pending ? (
          <Loading />
        ) : view.kind === "home" ? (
          <Home stats={stats} onPick={run} />
        ) : view.kind === "scope" ? (
          <ScopeView reason={view.reason} />
        ) : view.kind === "error" ? (
          <ErrorView />
        ) : view.kind === "coverage" ? (
          <CoverageView municipality={view.municipality} department={view.department} />
        ) : (
          <AnswerView
            question={view.question}
            answer={view.answer}
            filters={view.filters}
            feedback={view.feedback}
            onPick={run}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The one search box.
 *
 * Expanded on the home screen — a labelled "Buscar" button, room to read the
 * example placeholder — and compact everywhere else, so it can sit fixed at
 * the top without pushing the answer below the fold on a phone.
 */
function SearchBox({
  expanded,
  draft,
  setDraft,
  onSubmit,
  pending,
  sourceCount,
}: {
  expanded: boolean;
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: (question: string) => void;
  pending: boolean;
  sourceCount: number | null;
}) {
  return (
    <form
      className={`border-rule flex flex-col gap-3 border-b px-5 ${expanded ? "pt-5 pb-4.5" : "py-3"}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      {expanded ? (
        <>
          <p className="font-display text-[1.6rem] leading-[1.05] font-bold text-balance">
            ¿Qué buscás y en qué municipio?
          </p>
          <p className="text-muted text-[0.92rem] leading-relaxed">
            Una sola pregunta busca{" "}
            {sourceCount ? `en los ${sourceCount} sitios` : "en todos los sitios"} de la emergencia
            a la vez. Te devuelvo direcciones, horarios y quién lo publicó.
          </p>
        </>
      ) : null}

      <label htmlFor="pregunta" className="sr-only absolute -left-[9999px]">
        Escribí tu pregunta
      </label>
      <div className={expanded ? "flex flex-col gap-2" : "flex items-stretch gap-2"}>
        <input
          type="text"
          id="pregunta"
          name="pregunta"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ej: dónde llevo agua en Pereira"
          maxLength={800}
          autoComplete="off"
          disabled={pending}
          className={`border-official-bg bg-surface text-text placeholder:text-muted min-w-0 flex-1 border-2 px-3 text-base leading-relaxed outline-none disabled:opacity-60 ${
            expanded ? "min-h-[3.25rem]" : "min-h-[3rem]"
          }`}
        />
        <SendButton expanded={expanded} disabled={pending || !draft.trim()} />
      </div>
    </form>
  );
}

function SendButton({ expanded, disabled }: { expanded: boolean; disabled: boolean }) {
  const icon = (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h13" />
      <path d="M12.5 5.5 19 12l-6.5 6.5" />
    </svg>
  );

  if (expanded) {
    return (
      <button
        type="submit"
        disabled={disabled}
        className="bg-official-bg text-official-text font-display flex min-h-[3.25rem] items-center justify-center gap-2 text-[0.95rem] font-bold tracking-wide uppercase transition-opacity hover:opacity-90 disabled:opacity-35"
      >
        Buscar
        {icon}
      </button>
    );
  }

  return (
    <button
      type="submit"
      disabled={disabled}
      aria-label="Buscar"
      title="Buscar"
      className="bg-official-bg text-official-text grid min-h-[3rem] w-[3rem] shrink-0 place-items-center transition-opacity hover:opacity-90 disabled:opacity-35"
    >
      {icon}
    </button>
  );
}

/**
 * The strip under the search box. On the home screen it's the catalog's own
 * status; once there's a search, it becomes what was actually searched for
 * and where the results came from — the same slot, because it's answering
 * the same underlying question ("what do these fuentes actually have?").
 */
function StatusStrip({ view, stats }: { view: View; stats: CatalogStats | null }) {
  // Ni el rechazo por alcance, ni el de cobertura, ni una falla nuestra tienen
  // filtros que resumir.
  if (view.kind === "scope" || view.kind === "coverage" || view.kind === "error") return null;

  if (view.kind === "home") {
    if (!stats || stats.sourceCount === 0) return null;
    return (
      <Link
        href="/fuentes"
        className="bg-surface-2 border-rule hover:bg-border/30 flex items-center justify-between gap-3 border-b px-5 py-2.5"
      >
        <span className="stamp text-muted">
          {stats.recordCount} {stats.recordCount === 1 ? "aviso" : "avisos"} de {stats.sourceCount}{" "}
          {stats.sourceCount === 1 ? "fuente" : "fuentes"}
          {stats.lastObservedAt ? (
            <>
              <br />
              leídas por última vez {relativeTime(stats.lastObservedAt)}
            </>
          ) : null}
        </span>
        <span className="label border-rule shrink-0 border px-2 py-1.5">Ver cuáles</span>
      </Link>
    );
  }

  const { answer, filters } = view;
  const searched = [
    ...filters.categories.map((c) => CATEGORY_LABELS[c as Category]?.toLowerCase()).filter(Boolean),
    ...filters.types
      .map((t) => RECORD_TYPE_LABELS[t as RecordTypeV1]?.toLowerCase())
      .filter(Boolean),
    filters.municipality,
  ].filter(Boolean);
  const what = searched.length > 0 ? searched.join(" · ") : (filters.text ?? "tu pregunta");
  const sourceCount = stats?.sourceCount ?? null;

  const sources = new Map<string, number>();
  for (const r of answer.results) sources.set(r.sourceName, (sources.get(r.sourceName) ?? 0) + 1);
  const breakdown = [...sources.entries()].map(([name, n]) => `${n} de ${name}`).join(", ");

  return (
    <div className="bg-surface-2 border-rule flex flex-col gap-0.5 border-b px-5 py-2.5">
      <p className="stamp">
        Busqué <span className="text-text">{what}</span>
        {sourceCount ? ` en ${sourceCount} ${sourceCount === 1 ? "fuente" : "fuentes"}` : ""}
        {answer.results.length === 0 ? ". 0 avisos." : "."}
      </p>
      {answer.results.length > 0 ? (
        <p className="stamp text-muted">
          {answer.results.length} {answer.results.length === 1 ? "aviso" : "avisos"}: {breakdown}.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Buscar toma un par de segundos. Si pasa mucho más, algo se colgó.
 *
 * A los ocho segundos aparece una salida visible. En un celular no hay botón de
 * recargar a la mano y "deslizar hacia abajo" no es un gesto que todo el mundo
 * conozca: sin esto, quien se queda mirando el punto que late se va.
 */
function Loading() {
  const [demorado, setDemorado] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDemorado(true), 8000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <p className="stamp text-muted flex items-center gap-2" aria-live="polite">
        <span className="bg-accent inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
        Buscando en las fuentes conectadas…
      </p>
      {demorado ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="border-rule hover:border-accent flex min-h-[3rem] items-center justify-between gap-3 border px-3 text-left text-[0.92rem] font-semibold"
        >
          <span>Se está demorando · actualizar la página</span>
          <span aria-hidden="true" className="text-accent shrink-0">
            ↻
          </span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * The home screen.
 *
 * The examples are a ruled index, not chips. They are a directory of what can
 * be asked — an unordered set of entry points — so they get rules and no
 * numbering: numbers would claim a sequence that does not exist.
 */
function Home({
  stats,
  onPick,
}: {
  stats: CatalogStats | null;
  onPick: (question: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="label text-muted">Lo que más preguntan</span>
        <ul className="border-rule divide-border divide-y border-y">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className="group hover:text-accent flex w-full items-center justify-between gap-3 py-2.5 text-left text-[0.95rem] leading-snug"
              >
                <span>{s}</span>
                <span aria-hidden="true" className="text-muted group-hover:text-accent">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-rule flex flex-col gap-1.5 border-t pt-4">
        <span className="label text-muted">Lo que esto no hace</span>
        <p className="text-muted text-[0.9rem] leading-relaxed">
          No despacha ayuda, no verifica y no recibe reportes nuevos. Tampoco tiene listas de
          heridos ni de desaparecidos: eso lo maneja la Cruz Roja y el 123.
        </p>
      </div>

      {stats ? (
        <p className="stamp text-muted">
          {stats.sourceCount} {stats.sourceCount === 1 ? "sitio conectado" : "sitios conectados"}.
        </p>
      ) : null}
    </div>
  );
}

/**
 * What the site says when it cannot answer.
 *
 * Each reason gets its own routing. Someone asking whether a relative is hurt
 * and someone asking whether their building is safe need different people, and
 * a single generic refusal serves neither.
 *
 * Styled in the reserved red, not amber: these are questions about a life or
 * a person's safety, which is exactly what red is reserved for.
 */
/**
 * Nombro un municipio que todavia no cubrimos.
 *
 * Antes esa palabra se perdia y la respuesta traia lugares de otro
 * departamento sin decirlo: alguien en Pereira recibia albergues de Trujillo,
 * Valle. Decir que no llegamos ahi es util; contestar sobre otro lado es
 * peor que callarse.
 */
function CoverageView({ municipality, department }: { municipality: string; department: string }) {
  // Se arma desde la configuración, no a mano: este texto ya quedó mintiendo
  // una vez, cuando el área paso del Valle al Eje Cafetero y la frase siguió
  // diciendo "del Valle del Cauca".
  const cubiertos = joinInSpanish(OPERATING_ADMIN1_NAMES);

  return (
    <div className="border-warn-border bg-warn-bg text-warn-text border-l-2 px-3 py-3">
      <p className="font-display text-[1.15rem] leading-tight font-bold">
        Todavía no llegamos a {municipality}.
      </p>
      <p className="mt-2 text-[0.92rem] leading-relaxed">
        Hoy hay fuentes conectadas de {cubiertos}, y {municipality} está en {department}. Prefiero
        decírtelo a mostrarte lugares de otro departamento como si te sirvieran.
      </p>
      <p className="mt-2 text-[0.92rem] leading-relaxed">
        Si conocés un sitio que esté publicando ayuda en {department}, escribinos: conectar una
        fuente más es lo que más sirve.
      </p>
    </div>
  );
}

/**
 * El sitio falló, no la pregunta.
 *
 * Acá ya se reintentó y volvió a fallar, así que la acción principal es
 * recargar de verdad —si el servidor cambió debajo, repetir la misma llamada
 * falla igual—. Es un botón grande y sólido a propósito: en un celular no hay
 * botón de recargar a la vista y sin esto la gente se va.
 */
function ErrorView() {
  return (
    <div className="border-rule flex flex-col gap-3 border p-4">
      <p className="font-display text-[1.15rem] leading-tight font-bold">
        No pude buscar en este momento.
      </p>
      <p className="text-muted text-[0.92rem] leading-relaxed">
        Fue una falla nuestra, no de tu pregunta.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="bg-accent text-bg flex min-h-[3.25rem] items-center justify-center gap-2 px-3 text-[0.98rem] font-semibold"
      >
        Actualizar la página
        <span aria-hidden="true">↻</span>
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
  );
}

function ScopeView({ reason }: { reason: OutOfScopeReason }) {
  // Una mascota perdida duele, pero no es una emergencia: si se pinta con el
  // mismo rojo que "llamá al 123", el rojo deja de significar algo.
  if (reason === "lost_pet") {
    return (
      <div className="border-rule flex flex-col gap-3 border p-4">
        <LostPet />
      </div>
    );
  }

  return (
    <div className="border-danger-border bg-danger-bg text-danger-text flex flex-col gap-3 border p-4">
      {reason === "person_safety" ? <PersonSafety /> : null}
      {reason === "medical_emergency" ? <MedicalEmergency /> : null}
      {reason === "structure" ? <Structure /> : null}
    </div>
  );
}

/**
 * Mascotas perdidas: enviamos, no copiamos.
 *
 * Esos sitios guardan reportes de personas con su nombre y su WhatsApp. Copiar
 * eso rompe el invariante 6 y no le sirve a nadie: quien busca a su perro
 * necesita el sitio donde puede reportar y mirar fotos, no una copia nuestra
 * envejeciendo aparte.
 */
function LostPet() {
  return (
    <>
      <p className="font-display text-[1.15rem] leading-tight font-bold">
        No tengo reportes de mascotas. Estos sitios sí:
      </p>
      {/*
        Primero el del Eje Cafetero. Las otras dos son del Valle, y quien
        pregunta desde Pereira —la ciudad mas golpeada de ese lado— recibia
        solo enlaces de Cali. Este cubre Pereira, Dosquebradas, Manizales y
        Cali, y es el unico de los tres que no deja telefonos a la vista en su
        propio HTML.
      */}
      <div className="flex flex-col gap-2">
        <ReferralLink href="https://encuentratumascota.co/anuncios/se-busca">
          Encuentra tu Mascota — Eje Cafetero y Valle
        </ReferralLink>
        <ReferralLink href="https://reunemascotas.brannd.com.co/">
          Reúne Mascotas — perros y gatos
        </ReferralLink>
        <ReferralLink href="https://personal-hffxivhl.outsystemscloud.com/MascotasPerdidas/ReportList">
          Mascotas Perdidas — lista de reportes
        </ReferralLink>
      </div>
      <p className="text-muted text-[0.92rem] leading-relaxed">
        Son de otras personas, no los manejamos nosotros. Acá sí podés buscar dónde reciben comida o
        insumos para animales.
      </p>
    </>
  );
}

function ReferralLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="border-rule hover:border-accent flex min-h-[3rem] items-center justify-between gap-3 border px-3 text-[0.92rem] leading-snug font-semibold"
    >
      <span>{children}</span>
      <span aria-hidden="true" className="text-accent shrink-0">
        ↗
      </span>
    </a>
  );
}

/** The single most urgent action, styled as a solid pill — the same ground as the 123 band up top. */
function CallNow({ children }: { children: React.ReactNode }) {
  return (
    <p className="bg-danger-solid-bg text-danger-solid-fg flex min-h-[3rem] items-center justify-center px-3 text-center text-[0.95rem] font-semibold">
      {children}
    </p>
  );
}

function ReferralPill({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-danger-border text-danger-text flex min-h-[3rem] items-center px-3 text-[0.92rem] font-semibold">
      {children}
    </p>
  );
}

function PersonSafety() {
  return (
    <>
      <p className="font-display text-[1.15rem] leading-tight font-bold">
        No tengo listas de personas. Ninguna. Estos sí las tienen:
      </p>
      <div className="flex flex-col gap-2">
        <CallNow>Llamar al 123</CallNow>
        <ReferralPill>Cruz Roja — contacto familiar</ReferralPill>
        <ReferralPill>Medicina Legal</ReferralPill>
      </div>
      <p className="text-[0.92rem] leading-relaxed">
        Si sabés a qué hospital lo llevaron, preguntá en admisiones de ese hospital. Ojalá tengas
        noticias pronto.
      </p>
    </>
  );
}

function MedicalEmergency() {
  return (
    <>
      <p className="font-display text-[1.15rem] leading-tight font-bold">
        Si hay una emergencia médica, llamá ahora.
      </p>
      <CallNow>Llamar al 123</CallNow>
      <p className="text-[0.92rem] leading-relaxed">
        No despachamos ambulancias, no atendemos rescates y no damos orientación médica. Solo
        buscamos lo que otros sitios publican.
      </p>
    </>
  );
}

function Structure() {
  return (
    <>
      <p className="font-display text-[1.15rem] leading-tight font-bold">
        Nadie automático debería decidir si podés volver a tu casa.
      </p>
      <div className="flex flex-col gap-2">
        <CallNow>Llamar al 123 o a los bomberos</CallNow>
        <ReferralPill>Gestión del riesgo de tu municipio</ReferralPill>
      </div>
      <p className="text-[0.92rem] leading-relaxed">Eso lo determina una inspección presencial.</p>
    </>
  );
}

/**
 * Zero results is a dead end unless it comes with a next step. The
 * municipality is never dropped by the search itself — someone in Palmira
 * does not want Cartago — so only the person can choose to widen it.
 */
function EmptyActions({
  question,
  municipality,
  onPick,
}: {
  question: string;
  municipality: string | null;
  onPick: (question: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {municipality ? (
        <button
          type="button"
          onClick={() => onPick(withoutMunicipality(question, municipality) || question)}
          className="border-rule hover:border-accent flex min-h-[3rem] items-center justify-between gap-3 border px-3 text-left text-[0.92rem] leading-snug"
        >
          {/*
            No se nombra el departamento. Esta frase decia "en todo el Valle"
            y a alguien en Pereira le ofrecia buscar en un departamento que no
            es el suyo — el mismo error que ya corregimos en CoverageView. La
            busqueda ampliada no se limita a un departamento: quita el
            municipio y busca en todo lo que tenemos.
          */}
          <span>Buscar en toda la zona, no solo en {municipality}</span>
          <span aria-hidden="true" className="text-accent shrink-0 font-semibold">
            →
          </span>
        </button>
      ) : null}
      <Link
        href="/fuentes"
        className="border-rule hover:border-accent flex min-h-[3rem] items-center justify-between gap-3 border px-3 text-[0.92rem] leading-snug"
      >
        <span>Entrar directo a las fuentes conectadas</span>
        <span aria-hidden="true" className="text-accent shrink-0 font-semibold">
          →
        </span>
      </Link>
    </div>
  );
}

/** A disclosed reminder of what can be asked, for a question this site doesn't cover at all. */
function OffTopicHelp({ onPick }: { onPick: (question: string) => void }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-rule hover:border-accent flex min-h-[3rem] items-center justify-between gap-3 border px-3 text-left text-[0.92rem] leading-snug"
      >
        <span>Ver ejemplos de lo que puedo buscar</span>
        <span aria-hidden="true" className="text-accent shrink-0 font-semibold">
          →
        </span>
      </button>
    );
  }

  return (
    <ul className="border-rule divide-border divide-y border-y">
      {SUGGESTIONS.map((s) => (
        <li key={s}>
          <button
            type="button"
            onClick={() => onPick(s)}
            className="group hover:text-accent flex w-full items-center justify-between gap-3 py-2.5 text-left text-[0.95rem] leading-snug"
          >
            <span>{s}</span>
            <span aria-hidden="true" className="text-muted group-hover:text-accent">
              →
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AnswerView({
  question,
  answer,
  filters,
  feedback,
  onPick,
}: {
  question: string;
  answer: Answer;
  filters: AppliedFilters;
  feedback: FeedbackHandle | null;
  onPick: (question: string) => void;
}) {
  // Los gemelos entran al calculo aunque no se dibujen: son justamente los
  // que el filtro por tipo dejaba fuera de la lista.
  const sameplace = findPossibleSameplace([...answer.results, ...answer.companions]);
  const matchedCategories = new Set(filters.categories as Category[]);

  const isOffTopic = answer.notes.includes("off_topic");
  const isEmpty = answer.results.length === 0 && !isOffTopic;

  const titleCounts = new Map<string, number>();
  for (const r of answer.results) titleCounts.set(r.title, (titleCounts.get(r.title) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-[1.5rem] leading-[1.08] font-bold">{answer.text}</p>

      {answer.notes.map((note) =>
        NOTE_TEXT[note] ? (
          <p key={note} className="stamp text-muted">
            <strong className="text-text font-medium">{NOTE_TEXT[note].lead}</strong>{" "}
            {NOTE_TEXT[note].rest}
          </p>
        ) : null,
      )}
      {answer.notes.includes("widened") ? (
        <p className="stamp text-muted">Amplié la búsqueda: así de específico no había nada.</p>
      ) : null}

      {isEmpty ? (
        <EmptyActions question={question} municipality={filters.municipality} onPick={onPick} />
      ) : null}

      {isOffTopic ? <OffTopicHelp onPick={onPick} /> : null}

      {/*
        Above the cards, not below them.

        At the bottom nobody reached it: on a phone, after twenty shelter
        listings, the only people who ever saw it were the ones patient enough
        to scroll past what they came for — the opposite of the people whose
        answer failed. Here the person has read what we understood and what we
        are claiming, and has not scrolled yet.

        Not higher, though. Above the answer sentence it would ask "did this
        help?" before anything had been shown, and two of the chips —
        `ya_cerro`, `desactualizado` — are judgements about the records, which
        nobody can make before seeing one.

        After the empty-results block on purpose: when there is nothing to
        show, "probá con esto otro" is more use than a rating, so the recovery
        actions come first.

        Keyed on the turn so a new answer gets a new component. Today the
        loading state already unmounts this — `pending` swaps in <Loading/> —
        so the reset is incidental. Consent is not something to leave resting
        on an incidental: without the key, a change that kept the answer on
        screen while searching would carry a tick given for one question onto
        the text of the next.
      */}
      {feedback ? <Feedback key={feedback.turnId} handle={feedback} question={question} /> : null}

      {answer.results.length > 0 ? (
        <div className="flex flex-col gap-3">
          {answer.results.map((r) => {
            const related = sameplace.get(r.sourceRecordId);
            return (
              <ResultCard
                key={r.sourceRecordId}
                result={r}
                sameplace={related}
                disagrees={related ? statusesDisagree(r, related) : false}
                titleRepeats={(titleCounts.get(r.title) ?? 0) > 1}
                matchedCategories={matchedCategories}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Chips, in the order they are offered. Fixed list: no free text, so nothing to consent to. */
const REASON_LABELS: Record<FeedbackReason, string> = {
  no_entendio: "No entendió lo que pedí",
  otra_ciudad: "Me mostró otra ciudad",
  ya_cerro: "El lugar ya cerró",
  desactualizado: "La información está vieja",
  palabra: "No entendió una palabra que usé",
};

/**
 * Was this useful?
 *
 * Deliberately dumb: no parsing, no derived state, nothing that can throw. It
 * renders above the results and inside the same component, so anything that
 * broke here would unmount the shelter list with it — and somebody looking for
 * a shelter must never lose it because a feedback button had a bug.
 *
 * The thumb is sent the moment it is pressed. The panel that follows a
 * thumbs-down updates that same row, so a person who never finishes it is
 * still counted. Sending is fire-and-forget: `rateAnswer` swallows its own
 * failures and there is nothing useful to tell someone if it did not land.
 *
 * `caso` is the only handle a person has on their own row — there are no
 * accounts here — so it stays on screen after voting, which is when it starts
 * to matter.
 */
function Feedback({ handle, question }: { handle: FeedbackHandle; question: string }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [consented, setConsented] = useState(false);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Pressing a button unmounts the button, so focus falls to <body> and the
  // next Tab restarts at the top of the page. That cost nothing while this sat
  // at the end; now the results come after it, and a keyboard user would have
  // to walk the header and this whole block again to reach the cards they came
  // for. Focus moves to the block instead, which is where the next thing to
  // read just appeared.
  useEffect(() => {
    if (rating !== null) box.current?.focus();
  }, [rating, done]);

  function send(next: {
    rating: "up" | "down";
    reasons?: FeedbackReason[];
    consented?: boolean;
    comment?: string;
    /** Only the panel revises what the thumb already wrote. */
    detail?: boolean;
  }) {
    // Offline, a 429 during a flood, or a build id that changed under an open
    // tab all reject here. `rateAnswer` swallows its own database failures, but
    // it cannot swallow never having been reached.
    void rateAnswer({
      turnId: handle.turnId,
      context: handle.context,
      rating: next.rating,
      reasons: next.reasons,
      consented: next.consented,
      // Only sent when the box is ticked. With it unticked the server would
      // drop these anyway, but there is no reason to put them on the wire.
      questionText: next.consented ? question : undefined,
      comment: next.consented ? next.comment : undefined,
      detail: next.detail,
    }).catch(() => {});
  }

  function vote(value: "up" | "down") {
    setRating(value);
    send({ rating: value });
    if (value === "up") setDone(true);
  }

  function toggle(reason: FeedbackReason) {
    setReasons((current) =>
      current.includes(reason) ? current.filter((r) => r !== reason) : [...current, reason],
    );
  }

  return (
    // The rule is at the BOTTOM. A top rule would open a section whose visible
    // contents ran on into the whole shelter list, and the case code would sit
    // flush above the first card — reading as a label for that card, which is
    // the one string somebody is meant to quote about a specific record. A
    // bottom rule closes the block off from the results instead, and avoids
    // doubling up with `OffTopicHelp`, which ends in a rule of its own and can
    // render immediately above this.
    <div
      ref={box}
      tabIndex={-1}
      aria-live="polite"
      className="border-rule mb-1 flex flex-col gap-2 border-b pb-3 outline-none"
    >
      {rating === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="stamp text-muted">¿Te sirvió?</span>
          <button
            type="button"
            onClick={() => vote("up")}
            className="border-border hover:border-accent hover:text-accent border px-3 py-1 text-[0.85rem]"
          >
            Sí
          </button>
          <button
            type="button"
            onClick={() => vote("down")}
            className="border-border hover:border-accent hover:text-accent border px-3 py-1 text-[0.85rem]"
          >
            No
          </button>
          {/*
            Shown before anybody votes, not only after. It is the only handle a
            person has on this answer — there are no accounts — so somebody who
            wants to report a bad result without voting, or who comes back a day
            later, still has something to quote. FR5.
          */}
          <span className="stamp text-muted">Caso {handle.caso}</span>
        </div>
      ) : done ? (
        <p className="stamp text-muted">Gracias. Caso {handle.caso}.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="stamp text-muted">
            Gracias. Si querés, contanos qué pasó — todo es opcional.
          </p>

          <div className="flex flex-wrap gap-2">
            {(Object.keys(REASON_LABELS) as FeedbackReason[]).map((reason) => (
              <button
                key={reason}
                type="button"
                aria-pressed={reasons.includes(reason)}
                onClick={() => toggle(reason)}
                className={
                  reasons.includes(reason)
                    ? "border-accent text-accent border px-3 py-1 text-[0.85rem]"
                    : "border-border hover:border-accent border px-3 py-1 text-[0.85rem]"
                }
              >
                {REASON_LABELS[reason]}
              </button>
            ))}
          </div>

          {handle.textCapture ? (
            <>
              <label className="flex items-start gap-2 text-[0.85rem] leading-snug">
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(e) => setConsented(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Guardá mi pregunta y mi comentario para revisarlos. Se borran a los 30 días.{" "}
                  <Link
                    href="/privacidad"
                    className="hover:text-accent underline underline-offset-2"
                  >
                    Cómo tratamos estos datos
                  </Link>
                  .
                </span>
              </label>

              {consented ? (
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={800}
                  rows={3}
                  placeholder="¿Qué esperabas encontrar?"
                  className="border-border bg-surface w-full border p-2 text-[0.9rem]"
                />
              ) : null}
            </>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                send({ rating: "down", reasons, consented, comment, detail: true });
                setDone(true);
              }}
              // Filled, while the chips and the thumbs stay outlined: this is
              // the only button here that ends the interaction, and it was
              // reading as one more chip. Same treatment as the search submit
              // (`bg-accent text-bg`), so the two primary actions on the screen
              // look like the same kind of thing.
              //
              // Measured, not assumed: 6.4:1 on the light theme and 10.1:1 on
              // the dark one, both past WCAG AA for normal text.
              className="bg-accent text-bg border-accent border px-4 py-1 text-[0.85rem] font-semibold"
            >
              Enviar
            </button>
            <span className="stamp text-muted">Caso {handle.caso}</span>
          </div>
        </div>
      )}
    </div>
  );
}
