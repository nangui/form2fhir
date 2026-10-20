---
name: fhir-questionnaire
description: Rules for building FHIR R4 Questionnaires (SDC style) coded in LOINC in this project — required elements, R4 invariants, item types, LOINC search/panel rules, the extensions we use, and what the public HAPI validator does and does not check. Use when writing or reviewing the agent prompt, validate.ts, loinc.ts, fixtures, or any Questionnaire JSON.
---

# FHIR R4 Questionnaire + LOINC — project rules

Sources (check them when in doubt; this page is a summary, not the spec):
- FHIR R4 Questionnaire: https://hl7.org/fhir/R4/questionnaire.html
- SDC IG: https://build.fhir.org/ig/HL7/sdc/
- LOINC terms of use: https://loinc.org/kb/license/
- Clinical Tables LOINC API: https://clinicaltables.nlm.nih.gov/apidoc/loinc/v3/doc.html

## Resource shape
- `resourceType: "Questionnaire"`, `status` (1..1): `draft | active | retired | unknown`. We emit `draft`.
- Set `title`. `name`, if set, must be machine-friendly (que-0 warning), e.g. `PHQ9`.
- Optional `code[]` on the Questionnaire = the LOINC panel/form code when the whole form matches one.
- Do NOT set `meta.profile` to the SDC profile: public HAPI does not have the SDC IG and returns an error ("Failed to retrieve profile").
- Each item: `linkId` (1..1), `type` (1..1), `text`; optional `code[]`, `required`, `repeats`, `answerOption[]`, `answerValueSet`, `item[]`, `enableWhen[]`.

## Item types (R4)
`group | display | boolean | decimal | integer | date | dateTime | time | string | text | url | choice | open-choice | attachment | reference | quantity`

## R4 invariants (enforced by HAPI as errors, except que-0)
- que-0 (warning): `name` usable as an identifier.
- que-1: group items must have nested items; display items cannot have nested items.
- que-2: linkIds unique within the Questionnaire.
- que-3: display items cannot have a `code`.
- que-4: not both `answerOption` and `answerValueSet`.
- que-5: only `choice` / `open-choice` can have `answerValueSet`/`answerOption`.
- que-6: `required` and `repeats` not permitted on display items.
- que-8: no `initial` on group or display items.
- que-9: no `readOnly` on display items.
- que-10: `maxLength` only on simple question types.
- que-11: if `answerOption` is present, `initial[x]` must be absent.
- que-12: more than one `enableWhen` → `enableBehavior` required.
- que-13: multiple `initial` values only for repeating items.
- que-7: `enableWhen` operator `exists` → answer must be boolean.

## Our extra checks (server/lib/validate.ts, before HAPI)
- Every LOINC code anywhere in the resource (Questionnaire.code, item.code, answerOption.valueCoding, enableWhen…) must come from `search_loinc` results in the same run. Public HAPI does NOT verify LOINC codes; it only warns "codeSystem loinc.org not supported".
- The LOINC system must be spelled exactly `http://loinc.org` (variants such as `https://loinc.org` or the LOINC OID are rejected, not skipped).
- `choice` / `open-choice` items need a non-empty `answerOption` list. `answerValueSet` is rejected: LOINC answer-list IDs (LL…) can't be verified, and the preview can't expand a value set without a terminology server.
- Unique linkIds are compared after trimming whitespace.
- No `rendering-*` extensions (xhtml, markdown, style): the preview must never render model-written markup.
- `$validate` responses count only when the status is 200/400/422 with an OperationOutcome; anything else (404, 429, 5xx, HTML) means "validator unavailable", never "valid".

## LOINC usage
- Codes: question codes look like `8867-4`; answer codes look like `LA6568-5`; panels/forms look like `44249-1`. System is always `http://loinc.org`.
- Prefer an existing LOINC panel when the form is a known instrument (PHQ-9 = 44249-1, GAD-7 = 69737-5, AHC-HRSN = 96777-8). Put the panel code on `Questionnaire.code` and use the panel's member question codes on the items.
- When a question's LOINC term has a normative answer list (e.g. PHQ `LL358-3`), use those LA codes as `answerOption.valueCoding`. `search_loinc` returns only the first answer list per term, and only those LA codes are allowed.
- Search: `type=question` for questions, `type=form` for panels/forms (`type=panel` returns sub-questions, not panels). Searching `sf=LONG_COMMON_NAME,SHORTNAME,COMPONENT,SURVEY_QUEST_TEXT` ranks vital signs far better than the default fields (e.g. 8480-6 systolic BP comes first).
- Skip results whose name starts with "Deprecated".
- No match → leave the item uncoded. Never guess a code.
- Attribution (footer/README): "This material contains content from LOINC (http://loinc.org). LOINC is copyright © Regenstrief Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee and is available at no cost under the license at http://loinc.org/license."

## Extensions we use (core FHIR, accepted by public HAPI)
- Units: `http://hl7.org/fhir/StructureDefinition/questionnaire-unit` with `valueCoding` (system `http://unitsofmeasure.org`, UCUM code such as `/min`, `mm[Hg]`, `kg`, `Cel`).
- Answer scores: `http://hl7.org/fhir/StructureDefinition/ordinalValue` with `valueDecimal` on `answerOption`. Enforced in `validate.ts`: a LOINC answer with a known score must carry exactly that weight, weights must be numbers, and a list is either fully weighted or not at all.
- Panel members: a panel search fetches the LOINC form definition (`/loinc_form_definitions?loinc_num=`). Items under a panel code (on `Questionnaire.code` or a group) should use member codes; a stray code is a warning, not an error, because NLM definitions are not exhaustive (AUDIT-C lists 68517-2, printed forms ask 68518-0).

## Example (minimal, valid on public HAPI)
```json
{
  "resourceType": "Questionnaire",
  "status": "draft",
  "title": "Heart rate check",
  "item": [{
    "linkId": "hr", "type": "integer", "text": "Heart rate",
    "code": [{ "system": "http://loinc.org", "code": "8867-4", "display": "Heart rate" }],
    "extension": [{ "url": "http://hl7.org/fhir/StructureDefinition/questionnaire-unit",
      "valueCoding": { "system": "http://unitsofmeasure.org", "code": "/min", "display": "/min" } }]
  }]
}
```
