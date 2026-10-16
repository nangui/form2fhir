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
| `node eval/run.ts --url http://localhost:3000` | Runs every fixture through the real API (costs API credits) |

## Evaluation

Five blank forms (`eval/fixtures.json` lists each one's source and license), run end to end through `/api/convert` with Claude Sonnet 5.5:

| Form | Lang | Valid | Claude calls | LOINC coverage | Time | Est. cost |
|---|---|---|---|---|---|---|
| Vital Signs Intake | en | ✅ | 2 | 9/13 (69%) | 13.7 s | $0.039 |
| PHQ-9 | en | ✅ | 2 | 10/10 (100%) | 26.0 s | $0.076 |
| Pre-Visit Health Questionnaire (PDF) | en | ✅ | 2 | 6/11 (55%) | 13.2 s | $0.035 |
| Questionnaire relatif à l'état de santé du sportif mineur (Journal officiel, PDF) | fr | ✅ | 2 | 2/26 (8%) | 16.7 s | $0.053 |
| Bilan annuel de suivi — Diabète de type 2 (PDF, 3 pages) | fr | ✅ | 3 | 18/56 (32%) | 49.3 s | $0.145 |

**5/5 valid** · median 16.7 s · total ≈ $0.35 (2026-10-16, `eval/results/`).

How to read it:
- **Valid** means the HAPI FHIR `$validate` operation reported no errors *and* the server's own checks passed (every LOINC code was returned by a search in the same run).
- **LOINC coverage** counts every question item, including ones no terminology would code (name, consultation date, free-text notes, or the French sports questionnaire's custom questions). Codes are only added when a search result clearly matches; an uncoded item is preferred to a wrong code.
- A first run scored 8/56 on the diabetes form because the agent submitted after a single search round. Telling it to always search in English (the LOINC API is English-only), to cover standard measurements systematically and to search embedded instruments (AUDIT-C, PHQ-2) raised it to 18/56 with no wrong codes. Both runs are kept in `eval/results/`.
