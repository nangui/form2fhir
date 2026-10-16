<script setup lang="ts">
import { tokenizeJson } from '../utils/json-tokens'

const props = defineProps<{ value: unknown }>()
const toast = useToast()

const json = computed(() => JSON.stringify(props.value, null, 2))
const tokens = computed(() => tokenizeJson(json.value))
const fileName = computed(() => {
  const name = (props.value as { name?: unknown })?.name
  return `${typeof name === 'string' && name ? name : 'questionnaire'}.json`
})

async function copy() {
  try {
    await navigator.clipboard.writeText(json.value)
    toast.add({ title: 'Questionnaire JSON copied', icon: 'i-lucide-copy', color: 'success', duration: 2000 })
  } catch {
    toast.add({ title: 'Copy failed', description: 'Your browser blocked clipboard access. Use Download instead.', icon: 'i-lucide-circle-alert', color: 'error' })
  }
}

function download() {
  const url = URL.createObjectURL(new Blob([json.value], { type: 'application/fhir+json' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName.value })
  link.click()
  // Some browsers start the download asynchronously: revoking right away can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="relative">
    <div class="absolute end-2 top-2 z-10 flex gap-1">
      <UButton
        icon="i-lucide-copy"
        label="Copy"
        size="xs"
        color="neutral"
        variant="subtle"
        @click="copy"
      />
      <UButton
        icon="i-lucide-download"
        label="Download"
        size="xs"
        color="neutral"
        variant="subtle"
        @click="download"
      />
    </div>
    <pre class="max-h-[34rem] overflow-auto rounded-md border border-default bg-muted p-4 pt-10 font-mono text-xs leading-relaxed"><code><span
      v-for="(token, i) in tokens"
      :key="i"
      :class="token.type === 'plain' ? undefined : `json-${token.type}`"
    >{{ token.text }}</span></code></pre>
  </div>
</template>
