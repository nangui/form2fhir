// LHC-Forms (NLM) renders FHIR Questionnaires. Loaded from NLM's CDN on first use, with a pinned
// version, so it adds no npm dependency and no weight to the app bundle. Subresource Integrity
// hashes make the browser refuse any file that differs from the reviewed one.
const VERSION = '44.1.0'
const BASE = `https://lhcforms-static.nlm.nih.gov/lforms-versions/${VERSION}`

const STYLES = { href: `${BASE}/webcomponent/styles.css`, integrity: 'sha384-AHspTo8oeqH3IEAaBgvlbB3QzXNYnu4tI982JI/msZoRtaUaf1/n/fPCp03gGGeJ' }
// Order matters: zone.js, then the web component, then FHIR R4 support.
const SCRIPTS = [
  { src: `${BASE}/webcomponent/assets/lib/zone.min.js`, integrity: 'sha384-x1L9NEPdgtL5/HWo4R3WXWx0j/taTHe/Xb6ZBFqp4V++ziQE3ioTFEMYv417Lbuw' },
  { src: `${BASE}/webcomponent/lhc-forms.js`, integrity: 'sha384-QXiW+MA+EnyW9nPx5aZ2teZgexxdckpJ+CP5PzFAAuBbAJ9Q0d++Hh4QOyVIfuSQ' },
  { src: `${BASE}/fhir/R4/lformsFHIR.min.js`, integrity: 'sha384-5zeEpI7up95FU/KzeoUoPilmmgPiXed33YSbndoWjL4Rwc8IKTlP/t7eQkVwOqv3' }
]

export interface LForms {
  Util: {
    addFormToPage: (form: unknown, container: HTMLElement, options: { fhirVersion: 'R4' }) => Promise<unknown>
    removeFormsFromPage?: (container: HTMLElement) => void
  }
}

let loading: Promise<LForms> | undefined

export function loadLhcForms(): Promise<LForms> {
  loading ??= (async () => {
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', crossOrigin: 'anonymous', ...STYLES }))
    for (const script of SCRIPTS) await addScript(script)
    const lforms = (window as unknown as { LForms?: LForms }).LForms
    if (!lforms) throw new Error('LHC-Forms did not load')
    return lforms
  })().catch((error) => {
    loading = undefined // allow a retry
    throw error
  })
  return loading
}

function addScript({ src, integrity }: { src: string, integrity: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement('script'), { src, integrity, crossOrigin: 'anonymous', async: false })
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Could not load ${src}`))
    document.head.append(script)
  })
}
