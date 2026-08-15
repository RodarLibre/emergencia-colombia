# Contributing

**https://emergenciacolombia.org** · MIT

Real people use this to decide where to drive with a truck of water. That is
the whole standard: a wrong address costs someone a trip they could not afford
to waste, and a stale "open" is worse than no answer at all.

## The two contributions that help most

Neither of them is a feature.

**Words the search understands.** Someone in Buga knows they say *remesa* and
not *mercado*; nobody guesses that from outside. The vocabulary lives in a JSON
file, not in code — **[docs/VOCABULARIO.md](docs/VOCABULARIO.md)** explains how
to extend it without writing TypeScript. This is the highest-value contribution
and it needs no programming.

**One more source.** Every connected site multiplies what a single question
reaches. **[docs/ADDING-A-SOURCE.md](docs/ADDING-A-SOURCE.md)** has the steps,
and the checklist in [AGENTS.md](AGENTS.md) has the rules that come first:
read `robots.txt`, prefer a static asset over someone's API, no personal data,
and ship the source disabled.

Reporting a bad answer counts too. A screenshot of a question that answered
wrong has found more real defects here than the test suite has.

## Before you write code

Read **[CONVENTIONS.md](CONVENTIONS.md)** — the language rule, the comment
style, and the non-negotiables — and the ten invariants in
**[AGENTS.md](AGENTS.md)**.

The invariants are product decisions, not style preferences. Breaking one may
well be the right call, but it is a conversation, not a refactor: say so in the
pull request instead of doing it in passing.

Two that catch people out:

- **The model never sees a record.** It turns a Spanish question into filters;
  code does the rest. That is what makes it unable to invent an address.
- **Nothing is merged, and nothing is hidden.** Sources that disagree appear
  side by side, labelled. A record that stopped being published is marked, not
  deleted.

## Working on a change

Branch, then pull request. Nothing lands directly on `main`.

```bash
git switch -c fix/short-description
# ... work ...
pnpm typecheck && pnpm lint && pnpm test
git push -u origin fix/short-description
gh pr create
```

Getting the app running locally:

```bash
pnpm install
docker compose up -d db
pnpm db:push && pnpm db:seed      # seed data is fake and refuses to run in production
pnpm dev                          # localhost:3000
```

Integration tests need that database up: `pnpm test:integration`.

**Commit messages, code, comments and identifiers in English.** Interface text
in Spanish — the audience is people in an emergency in Colombia, and
translating the interface would make it worse. `CONVENTIONS.md` draws the line
precisely.

## What a good pull request looks like

- **One thing.** A doc pass and a search fix are two pull requests.
- **A test that fails without the change.** Especially for a wrong answer: the
  bug is the interesting part, and a test that passes either way proves
  nothing.
- **The reason in a comment**, when the code alone would look wrong. Several
  decisions here only make sense with their history attached — why `para` is
  excluded from locative prepositions, why out-of-scope detection never uses
  the model.

## Never commit

- `.env` or `.kamal/secrets`. Both are gitignored; keep it that way.
- The server address, or any host, hardcoded. It comes from the environment.
- Real phone numbers, names or addresses of private individuals — including in
  test fixtures. Sanitise fixtures and check them before committing.
- Correspondence, proposals, or third-party contacts. `docs/OUTREACH.md` and
  `docs/PROPUESTA-*.md` are gitignored on purpose.

Contact data from a source is mirrored **only** when that source collects
consent per person and has an agreement with us, declared per source with
`mirrorsContacts`. Scraping a number off a site that never consented stays
forbidden regardless of how public it looks.

## Questions

Open an issue. If it concerns a source's data or its terms, say which source —
those conversations usually end with someone being emailed, and it is better
done deliberately than quickly.
