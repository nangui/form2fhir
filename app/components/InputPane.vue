<script setup lang="ts">
import type { ConvertInput } from '../composables/useConvert'

defineProps<{ busy: boolean }>()
const emit = defineEmits<{ convert: [input: ConvertInput] }>()

const text = ref('')
const file = ref<File | null>(null)

const examples = [
  { label: 'Vital Signs Intake', icon: 'i-lucide-heart-pulse', path: '/examples/vital-signs.txt' },
  { label: 'PHQ-9', icon: 'i-lucide-clipboard-list', path: '/examples/phq-9.txt' },
  { label: 'PDF form', icon: 'i-lucide-file-text', path: '/examples/pre-visit-intake.pdf' }
]

const canConvert = computed(() => !!file.value || !!text.value.trim())

// Text and file are mutually exclusive: picking one clears the other.
watch(file, (value) => {
  if (value) text.value = ''
})
watch(text, (value) => {
  if (value) file.value = null
})

function submit() {
  if (file.value) emit('convert', { file: file.value })
  else if (text.value.trim()) emit('convert', { text: text.value })
}

const toast = useToast()

/** Loads an example into the input and runs it straight away. */
async function runExample(path: string) {
  try {
    const response = await fetch(path)
    // Never send an error page to the (paid) agent as if it were a form.
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (path.endsWith('.pdf')) {
      const pdf = new File([await response.blob()], path.split('/').pop()!, { type: 'application/pdf' })
      text.value = ''
      file.value = pdf
      emit('convert', { file: pdf })
    } else {
      const example = await response.text()
      file.value = null
      text.value = example
      emit('convert', { text: example })
    }
  } catch {
    toast.add({ title: 'Could not load the example', description: 'Check your connection and try again.', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}
</script>

<template>
  <section class="flex flex-col rounded-lg border border-default bg-default">
    <PaneLabel
      index="01"
      title="Blank form"
    />

    <div class="flex flex-1 flex-col gap-4 p-4">
      <UTextarea
        v-model="text"
        :rows="9"
        :maxrows="11"
        autoresize
        placeholder="Paste the text of a blank clinical form…"
        aria-label="Form text"
        class="w-full"
        :ui="{ base: 'font-mono text-xs leading-relaxed' }"
      />

      <UFileUpload
        v-model="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        icon="i-lucide-file-up"
        label="Or drop a PDF or image"
        description="PDF up to 5 pages, PNG / JPEG / WebP · max 3 MB"
        layout="list"
        class="w-full"
        :ui="{ base: 'min-h-20 border-dashed bg-transparent p-3', label: 'mt-1' }"
      />

      <div>
        <p class="mb-2 font-mono text-[11px] uppercase tracking-widest text-dimmed">
          Try an example
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="example in examples"
            :key="example.path"
            :label="example.label"
            :icon="example.icon"
            :disabled="busy"
            size="sm"
            color="neutral"
            variant="outline"
            @click="runExample(example.path)"
          />
        </div>
      </div>

      <UButton
        label="Convert to FHIR"
        trailing-icon="i-lucide-arrow-right"
        size="lg"
        block
        class="mt-auto"
        :loading="busy"
        :disabled="!canConvert || busy"
        @click="submit"
      />
    </div>
  </section>
</template>
