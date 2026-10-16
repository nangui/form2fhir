<script setup lang="ts">
import { loadLhcForms } from '../utils/lhc-forms'

const props = defineProps<{ questionnaire: unknown }>()

const container = ref<HTMLElement>()
const state = ref<'loading' | 'ready' | 'error'>('loading')

async function render() {
  const el = container.value
  if (!el) return
  state.value = 'loading'
  try {
    const lforms = await loadLhcForms()
    lforms.Util.removeFormsFromPage?.(el)
    el.replaceChildren()
    // LHC-Forms mutates its input; give it a plain copy, not the reactive proxy.
    await lforms.Util.addFormToPage(structuredClone(toRaw(props.questionnaire)), el, { fhirVersion: 'R4' })
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}

// LHC-Forms places its options popover under the focused field but sizes it to its content.
// Expose the field's width so the CSS can make the popover exactly as wide.
function matchPopoverWidth(event: FocusEvent) {
  const field = event.target
  if (field instanceof HTMLInputElement && field.classList.contains('ansList')) {
    document.documentElement.style.setProperty('--lhc-field-width', `${field.offsetWidth}px`)
  }
}

onMounted(render)
watch(() => props.questionnaire, render)
</script>

<template>
  <div>
    <div
      v-if="state === 'loading'"
      class="space-y-3"
    >
      <USkeleton class="h-5 w-2/3" />
      <USkeleton class="h-9 w-full" />
      <USkeleton class="h-9 w-full" />
      <USkeleton class="h-9 w-5/6" />
    </div>
    <UAlert
      v-if="state === 'error'"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Preview unavailable"
      description="The LHC-Forms renderer (NLM) could not be loaded or could not display this Questionnaire. The JSON, codes and validation tabs are unaffected."
    />
    <div
      ref="container"
      class="lhc-preview max-h-[34rem] overflow-auto rounded-md border border-default p-2 shadow-sm"
      :class="{ hidden: state !== 'ready' }"
      @focusin="matchPopoverWidth"
    />
  </div>
</template>
