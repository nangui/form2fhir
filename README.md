# Form2FHIR

**Any clinical form → a valid FHIR Questionnaire.**

Paste a blank clinical form, or upload a PDF or a screenshot. An AI agent built on the Claude API turns it into a FHIR R4 Questionnaire (SDC), with questions coded in LOINC. It keeps correcting itself until the Questionnaire passes validation.

> The model proposes, the validator decides.

**Live demo: [form2fhir.vercel.app](https://form2fhir.vercel.app)** · Demo only: blank forms, no real patient data. Not a medical device.

## How it works

```
Browser ── POST /api/convert (text | PDF | image) ──► Nuxt server route
   ▲                                                      │ size, type and rate-limit checks
   │ Server-Sent Events: each step, then the result       ▼
   └───────────────────────────────────────────── agent loop (≤ 4 Claude calls)
                                    ┌───────────────────────┴──────────────────────┐
                              search_loinc                               submit_questionnaire
                         NLM Clinical Tables API              server checks ─► HAPI FHIR $validate
                                                              errors go back to Claude to fix
```

1. Claude reads the form (text, or a PDF / image natively) and calls **`search_loinc`** with every question worth coding. The server queries the NLM Clinical Tables LOINC API and remembers every code it returned. For a known instrument (PHQ-9, AUDIT-C…) it also fetches the panel's official questions, with their answers and scores.
2. Claude calls **`submit_questionnaire`** with a complete FHIR R4 Questionnaire. The server checks what HAPI can't (every LOINC code must come from step 1; every scored LOINC answer carries its exact score as an `ordinalValue`; choice items need answer options; no HTML rendering extensions), warns when an item under a panel uses a code that is not one of the panel's questions, then calls **HAPI FHIR `$validate`**.
3. Errors go back to Claude as a tool error and it resubmits the whole resource. The run stops when the Questionnaire is valid, or after 4 Claude calls with the last attempt shown as not valid.

Every step streams to the UI, which renders the result with NLM's [LHC-Forms](https://lhncbc.github.io/lforms/), plus the JSON, the codes table and the validator report.

## Design choices

- **Hand-written agent loop, no framework.** About 200 lines in `server/lib/agent.ts`, so every step can be traced and tested with a scripted fake client.
- **The validator decides, and the server enforces the codes.** Public HAPI does not check LOINC codes, so the server rejects any code the search did not return. The model can't invent one.
- **One POST that streams back.** `EventSource` only supports GET, so the browser reads the `text/event-stream` body of a `fetch` POST. No server-side state, which suits serverless.
- **Few dependencies.** Nuxt, Nuxt UI, the Anthropic SDK and Vitest. LHC-Forms loads from NLM's CDN on demand, pinned and checked with Subresource Integrity. JSON highlighting is a 30-line tokenizer.
- **Guardrails for a public demo.**
  - Per-IP and daily rate limits, which only count real conversions.
  - Size, type and page caps on uploads, and a token count before any paid call.
  - A 120 s run budget and capped `max_tokens` and searches.
  - Cross-site requests rejected.
  - Form content is treated as data, never as instructions.

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

## Attribution

- This material contains content from [LOINC](https://loinc.org). LOINC is copyright © Regenstrief Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee and is available at no cost under the license at [loinc.org/license](https://loinc.org/license). LOINC searches use the [NLM Clinical Tables API](https://clinicaltables.nlm.nih.gov/).
- FHIR® is the registered trademark of HL7 and is used with the permission of HL7.
- Questionnaire preview by [LHC-Forms](https://lhncbc.github.io/lforms/) (U.S. National Library of Medicine). Validation by the public [HAPI FHIR](https://hapi.fhir.org/) test server.
- Built with the [Claude API](https://platform.claude.com/).

## License

Code: [MIT](LICENSE). The forms used as examples and eval fixtures keep their own licenses, listed in `eval/fixtures.json` (PHQ-9: Pfizer, free to reproduce; the French sports questionnaire: an official text published in the Journal officiel; the other forms were written for this project and are CC0).
