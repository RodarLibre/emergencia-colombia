# Conventions

## Language

**English** for everything a developer reads:

- Identifiers, types, file names
- Comments and JSDoc
- Commit messages
- Log messages and internal error strings

**Spanish** for everything a user reads. The audience is people in Valle del
Cauca during an emergency; translating the interface would make it worse.

- UI copy, labels, disclaimers
- User-facing URLs and query params (`/?p=`, `/fuentes`, `/salud`, `?fuente=`)
- Vocabulary display labels (`CATEGORY_LABELS`, `STATUS_LABELS`)
- The model's system prompt, and the JSON keys it emits — the prompt is Spanish
  because the questions are Spanish

Anything written before this file follows the old convention (Spanish comments).
It is not being retrofitted; new and modified code uses English.

## Comments

Explain **why**, not what. The code says what it does.

Comments here carry a lot of weight because several decisions look wrong
without their reason. Examples worth preserving in that style:

- Why `para` and `hacia` are excluded from locative prepositions (they mark the
  beneficiary, not the location).
- Why out-of-scope detection is deterministic only (the model flagged it at
  random, and a false positive denies someone an answer).
- Why search results are never cached (serving "open" after it closed is the
  failure this project exists to prevent).

When a decision is measured, put the number in the comment. `reasoning_effort:
low` is a requirement, not a tweak, and the comment says why: at medium the
model spends the whole token budget reasoning and emits nothing.

## Non-negotiables

These are product invariants, not style preferences. Changing one is a product
decision, not a refactor:

1. Every public result names its source, with a timestamp and a link.
2. Observations are immutable. A change creates a new one.
3. Records are never deleted because they stopped appearing in a listing. Only
   an explicit withdrawal by the source removes one.
4. Nothing is merged. Conflicting sources are shown side by side.
5. Location precision is never upgraded by inference.
6. Contact data is not copied. Link to the source instead.
7. `robots.txt` and source terms are respected, with no workaround.
8. The model translates the question, never the answer. It never sees a record.
9. Any AI failure degrades to deterministic search, never to an error page.
10. Sources start disabled and are enabled one at a time.

## Testing

Verification so far has been manual (throwaway `tsx` scripts, `curl`, real
container runs). That found real bugs, but none of it is repeatable.

Gaps worth closing, highest value first:

1. Unit tests for the text logic, using the edge cases already discovered:
   `fold`, `resolveMunicipality` (ambiguous names across departments),
   `findMunicipalityInText` (beneficiary vs location, venue names that match
   municipalities), `extractCategories`, `buildTextQuery` (the OR-query fix),
   `redactContact`.
2. Adapter tests against the sanitized fixtures in `fixtures/`.
3. Guard tests: quarantine on count collapse, demo-data wall, rate limit
   windows.
4. ESLint + Prettier. Neither is configured yet.
