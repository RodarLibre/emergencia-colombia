# Using the question box

Every example below was run against the live catalog and the result counts are
real. When something does not work well, it says so.

## What it is

One text box. You write a question in Spanish, it searches every connected
source at once, and every result names where it came from, when the source last
updated it, and links back to the original.

It is **not** a chatbot that answers in prose. It never writes a sentence about
a shelter. The model's only job is to turn your question into search filters;
the answer is always the records themselves.

That is why it cannot invent a collection point that does not exist — it never
sees a record in the first place.

## Questions that work

| Question | Understood as | Results |
|---|---|---|
| `dónde puedo llevar agua en Palmira` | collection point · Palmira · water | 11 |
| `dónde recibo donaciones en Buga` | collection point · Guadalajara de Buga | 7 |
| `acopios en Buenaventura` | collection point · Buenaventura | 4 |
| `dnd dejo comida en tulua` | collection point · Tuluá · food | 2 |
| `puntos que reciben insumos médicos` | collection point · medical supplies | 40 |
| `quién recibe ropa en Cartago` | Cartago · clothing | 3 |
| `cuál fue la magnitud del sismo` | seismic event | 7 |
| `hubo réplicas anoche` | seismic event | 7 |

Things that are handled and do not need care:

- **Typos and missing accents.** `dnd dejo comida en tulua` works.
- **Local short names.** `Buga` resolves to Guadalajara de Buga, and does not
  get confused with Bugalagrande.
- **Ambiguous municipality names.** There are 67 names shared across
  departments — `Candelaria`, `La Unión`, `Restrepo`, `San Pedro`. Within the
  coverage area they resolve to Valle del Cauca.

## Reading a result

Each card carries, in this order:

1. **Name**, plus what distinguishes it when several share a name. There are 17
   places called "Centro Temporal de Acopio", so the heading reads
   `Centro Temporal de Acopio · Metropolitano del Norte`.
2. **Address and opening hours**, when the source publishes them. This is the
   part you act on.
3. **Type, status and categories.**
4. **Municipality**, or "la fuente no especificó municipio" when the source only
   gave a neighborhood. That label is honest, not a bug.
5. **Two dates**: when the source says it updated, and when this site read it.
   They are different things and both are shown.
6. **Who claims what**: "Fuente oficial (SGC)", "Verificado por Donde Ayudo
   Valle", or "Reporte comunitario sin verificar". Never a bare "verified".
7. **A link to the original**, which is where you confirm before you travel.

Above the results, a line names every source that contributed and how many
records each one gave.

### Two warnings worth stopping for

**"Las fuentes no coinciden"** — two sources describe what looks like the same
place with contradicting states, for example one says a shelter is full and
another says it is still taking people. Both are shown with what each one says.
Nothing is merged and no winner is picked. Confirm with the source before going.

**"No reconfirmado recientemente"** — nobody has confirmed this in a while. It
does **not** mean the information is wrong or expired; it means it is old. A
collection point is expected to be reconfirmed every 12 hours, an alert every
hour. Earthquakes never go stale: they happened.

## Correcting what it understood

After you ask, the filters appear as chips: `Punto de acopio · Palmira · Agua`.
Each one has an **×**. Removing a chip re-runs the search immediately and
**costs no further AI call** — the interpretation happens once, and everything
after that is plain navigation.

If it misread you, remove the wrong chip rather than rewriting the question.
It is faster and it always works, even when the quota has run out.

## When it widens the search

If your filters match nothing, the search widens instead of showing a blank
page, and says so: *"no se encontró nada con … así que se amplió la búsqueda"*.

It drops categories first, then the type of place. **It never drops the
municipality** — someone in Palmira does not want results from Cartago.

Real example: `dónde recibo pañales` is read as a service point, but diapers are
at collection points. Rather than returning nothing, it widens and tells you the
results are more general than what you asked.

## What it will not answer

Some questions are routed straight to official channels, with no search:

- Medical symptoms or urgency — `me duele el pecho`
- Requests to send help — `manden una ambulancia`, `hay gente atrapada`
- Whether a building is safe — `es seguro volver a mi casa`
- Missing people — `busco a mi hermano`

For those it shows **123** and the relevant official channel. This detection is
deterministic and does not depend on the AI being up.

The **123** notice is pinned to the top of every page regardless of what you
ask.

## When the AI is off or the quota runs out

Three things can happen, and none of them is an error page:

| What you see | What happened |
|---|---|
| Normal results | The question was understood |
| *"Alcanzaste el límite de preguntas…"* | 10 per hour per browser. Your text was searched as-is |
| *"No se pudo interpretar la pregunta…"* | The provider failed or is off. Your text was searched as-is |

In the last two cases search still works, filters still work, and the chips are
still editable. Only the natural-language reading of your question is missing.

## Known limits

Worth knowing before you rely on it:

- **Only what the connected sources publish.** Empty results mean nobody
  connected here published it — not that no help exists. The
  [/fuentes](/fuentes) page links to every source so you can check directly.
- **Nothing here is verified.** This site repeats what others publish, with the
  date and the link. Confirm before you travel.
- **Individual needs, pets and missing people are not included.** Only
  institutional records: collection points, service points, shelters, official
  updates, hazards, seismic events. See *Data scope* in the README.
- **Coverage is Valle del Cauca.** The data model handles the whole country,
  but only one department is announced as covered.
- **Some records have no municipality**, when the source only published a
  neighborhood. They still appear under that department's filter, labeled.
