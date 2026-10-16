# Form2FHIR

**Any clinical form → a valid FHIR Questionnaire.**

Paste a blank clinical form, or upload a PDF or a screenshot. An AI agent built on the Claude API turns it into a FHIR R4 Questionnaire (SDC), with questions coded in LOINC. It keeps correcting itself until the Questionnaire passes validation.

> The model proposes, the validator decides.

**Demo only: blank forms, no real patient data. Not a medical device.**

## Run locally
```bash
cp .env.example .env   # set ANTHROPIC_API_KEY
pnpm install
pnpm dev
```

## Scripts
| Command | What it does |
|---|---|
| `pnpm test` | Unit tests (offline) |
| `pnpm test:live` | Smoke tests against the LOINC search and HAPI FHIR APIs |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | Quality gates |

*Work in progress: architecture, eval results and attribution notes will be added as milestones land.*
