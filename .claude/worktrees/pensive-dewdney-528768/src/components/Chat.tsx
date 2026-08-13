"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { ask, type AppliedFilters } from "@/app/actions";
import { ResultCard } from "@/components/ResultCard";
import type { Answer, AnswerNote } from "@/lib/answer";
import type { OutOfScopeReason } from "@/lib/intent";
import { findPossibleSameplace, statusesDisagree } from "@/lib/relate";
import { CATEGORY_LABELS, RECORD_TYPE_LABELS, type Category, type RecordTypeV1 } from "@/lib/vocab";

/**
 * The conversation.
 *
 * It reads like a chat, but the assistant's words are composed by code from
 * real records — see `composeAnswer`. The model only turns the question into
 * filters and never sees a record, so nothing here can invent an address.
 *
 * The two voices are deliberately unequal. The person's question is a small
 * tinted block; the reply is unboxed prose in the page's own voice, followed
 * by the notices it is quoting. The site is not a character talking to you —
 * it is a board reading itself out loud.
 *
 * History is kept in memory for the session only. Nothing about a conversation
 * is stored: a question can contain a name, an address or a health detail.
 */

/** Resting height of the composer, in px. Must match `min-h-[5rem]` below. */
const COMPOSER_RESTING_HEIGHT = 80;
const COMPOSER_MAX_HEIGHT = 180;

const SUGGESTIONS = [
  "¿Dónde puedo llevar agua en Palmira?",
  "Albergues en Cali",
  "¿Quién recibe insumos médicos?",
  "¿Hubo réplicas anoche?",
];

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; answer: Answer; filters: AppliedFilters }
  | { id: number; role: "assistant"; outOfScope: OutOfScopeReason };

const NOTE_TEXT: Partial<Record<AnswerNote, string>> = {
  widened: "No encontré nada tan específico, así que amplié la búsqueda.",
  rate_limited:
    "Alcanzaste el límite de preguntas interpretadas por hora. Busqué tu texto tal cual.",
  fallback: "No pude interpretar la pregunta en este momento, así que busqué tu texto tal cual.",
  busy: "Estamos recibiendo mucha demanda, así que respondo más rápido y sin interpretar el texto.",
};

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  // Grows with the question up to a ceiling, then scrolls. Someone describing
  // what they need should be able to see what they wrote.
  //
  // Below the resting size no inline height is written at all, and CSS decides.
  // Writing one unconditionally froze a bad hydration measurement — the empty
  // box rendered at the 180px ceiling, and since `draft` never changed, the
  // effect never ran again to correct it.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    // Empty means the resting height, with no measuring at all. Measuring on
    // mount produced 178px for an empty box — the fonts had not settled — and
    // because `draft` never changed, nothing ever ran again to correct it. An
    // empty composer has no content to fit, so there is nothing to measure.
    if (draft.length === 0) {
      el.style.height = "";
      return;
    }

    el.style.height = "auto";
    const grown = Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT);
    el.style.height = grown > COMPOSER_RESTING_HEIGHT ? `${grown}px` : "";
  }, [draft]);

  function send(question: string) {
    const text = question.trim();
    if (!text || pending) return;

    setMessages((prev) => [...prev, { id: nextId.current++, role: "user", text }]);
    setDraft("");

    startTransition(async () => {
      const result = await ask(text);
      setMessages((prev) => [
        ...prev,
        result.kind === "out_of_scope"
          ? { id: nextId.current++, role: "assistant", outOfScope: result.reason }
          : {
              id: nextId.current++,
              role: "assistant",
              answer: result.answer,
              filters: result.filters,
            },
      ]);
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      {messages.length === 0 ? <Opening onPick={send} /> : null}

      <ol className="flex flex-col gap-6">
        {messages.map((m) =>
          m.role === "user" ? (
            <li key={m.id} className="enters flex justify-end">
              <p className="bg-accent-soft text-text max-w-[85%] rounded-sm px-3 py-2 text-[0.95rem] leading-snug">
                {m.text}
              </p>
            </li>
          ) : (
            <li key={m.id} className="enters">
              {"outOfScope" in m ? (
                <OutOfScopeNotice reason={m.outOfScope} />
              ) : (
                <AnswerNotice message={m} />
              )}
            </li>
          ),
        )}

        {pending ? (
          <li className="stamp text-muted flex items-center gap-2" aria-live="polite">
            <span className="bg-accent inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
            Buscando en las fuentes conectadas…
          </li>
        ) : null}
      </ol>

      <div ref={endRef} />

      {/* Holds the composer at the bottom while the conversation is still short. */}
      <div className="flex-1" aria-hidden="true" />

      <form
        className="bg-bg border-rule sticky bottom-0 flex items-end gap-2 border-t py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor="pregunta" className="sr-only absolute -left-[9999px]">
          Escribí tu pregunta
        </label>
        <textarea
          id="pregunta"
          name="pregunta"
          ref={inputRef}
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — what every chat does.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder="Escribí tu pregunta…"
          maxLength={800}
          autoComplete="off"
          disabled={pending}
          className="border-border bg-surface text-text placeholder:text-muted focus:border-accent min-h-[5rem] min-w-0 flex-1 resize-none rounded-sm border px-3 py-2.5 text-base leading-relaxed disabled:opacity-60"
        />
        <SendButton disabled={pending || !draft.trim()} />
      </form>
    </div>
  );
}

/**
 * Send.
 *
 * A glyph rather than the word "Preguntar": it costs a third of the width on a
 * phone, and the arrow is the one control everyone already knows from every
 * messaging app. The accessible name still says what it does, and the target
 * stays at 44px because this gets tapped one-handed, outdoors, in a hurry.
 */
function SendButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-label="Enviar pregunta"
      title="Enviar pregunta"
      className="bg-accent text-accent-fg grid h-11 w-11 shrink-0 place-items-center rounded-sm transition-opacity hover:opacity-90 disabled:opacity-35"
    >
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
        <path d="M12 19V5" />
        <path d="M5.5 11.5 12 5l6.5 6.5" />
      </svg>
    </button>
  );
}

/**
 * The empty state.
 *
 * The examples are a ruled index, not chips. They are a directory of what can
 * be asked — an unordered set of entry points — so they get rules and no
 * numbering: numbers would claim a sequence that does not exist.
 */
function Opening({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="font-display text-[1.35rem] leading-tight font-medium text-balance">
        Una pregunta, y busco a la vez en todos los sitios de la emergencia que están conectados.
      </p>
      <p className="text-muted text-[0.9rem] leading-relaxed">
        Cada resultado dice de dónde salió, cuándo lo actualizó esa fuente y enlaza al original.
        Aquí no se verifica nada ni se reciben reportes nuevos.
      </p>

      <div className="mt-1 flex flex-col gap-2">
        <span className="label text-muted">Por ejemplo</span>
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
    </div>
  );
}

/**
 * What the site says when it cannot answer.
 *
 * Each reason gets its own routing. Someone asking whether a relative is hurt
 * and someone asking whether their building is safe need different people, and
 * a single generic refusal serves neither. Telling a person in distress "this
 * is out of scope" without saying who CAN answer is its own kind of failure.
 */
function OutOfScopeNotice({ reason }: { reason: OutOfScopeReason }) {
  return (
    <div className="border-warn-border bg-warn-bg text-warn-text rounded-sm border-l-2 px-3 py-3 text-[0.9rem] leading-relaxed">
      {reason === "person_safety" ? <PersonSafety /> : null}
      {reason === "medical_emergency" ? <MedicalEmergency /> : null}
      {reason === "structure" ? <Structure /> : null}
    </div>
  );
}

function Referrals({ items }: { items: readonly React.ReactNode[] }) {
  return (
    <ul className="border-warn-border mt-3 flex flex-col gap-2.5 border-t pt-3">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function PersonSafety() {
  return (
    <>
      <p className="font-display text-[1.05rem] leading-tight font-semibold">
        Este sitio no puede decirte si una persona está herida ni dónde se encuentra.
      </p>
      <p className="mt-2">
        No tenemos listas de heridos, de fallecidos ni de personas desaparecidas, y no vamos a
        deducirlas. Esa información la manejan instituciones que sí pueden confirmarla:
      </p>
      <Referrals
        items={[
          <>
            <span className="label block">Riesgo de vida ahora</span>
            Llamá al <strong className="font-mono font-medium">123</strong>.
          </>,
          <>
            <span className="label block">Localizar a un familiar</span>
            Cruz Roja Colombiana, programa de Restablecimiento del Contacto Familiar.
          </>,
          <>
            <span className="label block">Si sabés a qué hospital lo llevaron</span>
            Preguntá en admisiones de ese hospital, o en la Secretaría de Salud del municipio.
          </>,
          <>
            <span className="label block">Personas fallecidas</span>
            Instituto Nacional de Medicina Legal y Ciencias Forenses.
          </>,
        ]}
      />
      <p className="mt-3">Ojalá tengas noticias pronto.</p>
    </>
  );
}

function MedicalEmergency() {
  return (
    <>
      <p className="font-display text-[1.05rem] leading-tight font-semibold">
        Si hay una emergencia médica, llamá al <span className="font-mono font-medium">123</span>{" "}
        ahora.
      </p>
      <p className="mt-2">
        Este sitio no despacha ambulancias, no atiende rescates y no da orientación médica. Solo
        busca lo que otros sitios publican sobre puntos de acopio, albergues y comunicados.
      </p>
    </>
  );
}

function Structure() {
  return (
    <>
      <p className="font-display text-[1.05rem] leading-tight font-semibold">
        Este sitio no puede evaluar si una estructura es segura.
      </p>
      <p className="mt-2">
        Ninguna respuesta automática debería decidir si podés volver a tu casa. Eso lo determina una
        inspección presencial:
      </p>
      <Referrals
        items={[
          <>
            <span className="label block">Riesgo inminente de colapso</span>
            Llamá al <strong className="font-mono font-medium">123</strong> o a los bomberos.
          </>,
          <>
            <span className="label block">Evaluación de daños</span>
            Oficina de gestión del riesgo de tu municipio.
          </>,
        ]}
      />
    </>
  );
}

function AnswerNotice({
  message,
}: {
  message: { role: "assistant"; answer: Answer; filters: AppliedFilters };
}) {
  const { answer, filters } = message;
  const sameplace = findPossibleSameplace(answer.results);

  const titleCounts = new Map<string, number>();
  for (const r of answer.results) titleCounts.set(r.title, (titleCounts.get(r.title) ?? 0) + 1);

  const sources = new Map<string, { name: string; count: number }>();
  for (const r of answer.results) {
    const prev = sources.get(r.sourceSlug);
    if (prev) prev.count += 1;
    else sources.set(r.sourceSlug, { name: r.sourceName, count: 1 });
  }

  // What the question was taken to mean, in the reader's words rather than the
  // database's. Shown so a wrong reading is visible instead of hidden.
  const understood = [
    filters.municipality,
    ...filters.types.map((t) => RECORD_TYPE_LABELS[t as RecordTypeV1] ?? t),
    ...filters.categories.map((c) => CATEGORY_LABELS[c as Category] ?? c),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[1.02rem] leading-relaxed">{answer.text}</p>

      {answer.notes.map((note) =>
        NOTE_TEXT[note] ? (
          <p key={note} className="stamp text-muted">
            {NOTE_TEXT[note]}
          </p>
        ) : null,
      )}

      {understood.length > 0 ? (
        <p className="stamp text-muted">Interpreté: {understood.join(" · ")}</p>
      ) : null}

      {answer.results.length > 0 ? (
        <>
          {/* Every reply names where it came from. Non-negotiable. */}
          <p className="stamp text-muted border-rule border-t pt-2">
            Recopilado de{" "}
            {[...sources.values()].map((s, i, all) => (
              <span key={s.name}>
                {i > 0 ? (i === all.length - 1 ? " y " : ", ") : ""}
                <span className="text-text">{s.name}</span> ({s.count})
              </span>
            ))}
            . Este sitio no verifica: cada resultado enlaza a su fuente.
          </p>

          <div className="flex flex-col gap-2">
            {answer.results.map((r) => {
              const related = sameplace.get(r.sourceRecordId);
              return (
                <ResultCard
                  key={r.sourceRecordId}
                  result={r}
                  sameplace={related}
                  disagrees={related ? statusesDisagree(r, related) : false}
                  titleRepeats={(titleCounts.get(r.title) ?? 0) > 1}
                />
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
