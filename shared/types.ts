export interface ValidationIssue {
  severity: 'error' | 'warning'
  source: 'local' | 'hapi'
  message: string
  /** FHIRPath-like location, e.g. `Questionnaire.item[1]`. */
  location?: string
}

export type ExternalService = 'loinc' | 'validator'
