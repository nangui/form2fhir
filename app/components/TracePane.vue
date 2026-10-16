<script setup lang="ts">
import type { ConvertResult, TraceStep } from '../../shared/types'

const props = defineProps<{
  status: 'idle' | 'running' | 'done' | 'error'
  steps: TraceStep[]
  result?: ConvertResult
  coverage?: { coded: number, total: number }
  error?: string
}>()

const KIND_ICONS: Record<TraceStep['kind'], string> = {
  model: 'i-lucide-sparkles',
  search_loinc: 'i-lucide-search',
  validate: 'i-lucide-shield-check'
}

// Live elapsed time while the agent works.
const startedAt = ref(0)
const now = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
watch(() => props.status, (status) => {
  clearInterval(timer)
  if (status === 'running') {
    startedAt.value = now.value = Date.now()
    timer = setInterval(() => (now.value = Date.now()), 100)
  }
})
onBeforeUnmount(() => clearInterval(timer))

const elapsed = computed(() => props.result?.durationMs ?? now.value - startedAt.value)
const stats = computed(() => {
  if (!props.result || !props.coverage) return []
  return [
    { label: 'Claude calls', value: props.result.iterations },
    { label: 'Time', value: seconds(props.result.durationMs) },
    { label: 'LOINC', value: `${props.coverage.coded}/${props.coverage.total}` }
  ]
})

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`
}

function markerClass(step: TraceStep) {
  if (step.status === 'error') return 'border-error/40 bg-error/10 text-error'
  if (step.status === 'running') return 'border-primary/40 bg-primary/10 text-primary'
  if (step.kind === 'validate') return 'border-success/40 bg-success/10 text-success'
  return 'border-default bg-elevated text-toned'
}
</script>

<template>
  <section class="flex flex-col rounded-lg border border-default bg-default">
    <PaneLabel
      index="02"
      title="Agent trace"
    >
      <span
        v-if="status === 'running' || result"
        class="font-mono text-xs tabular-nums text-muted"
      >{{ seconds(elapsed) }}</span>
    </PaneLabel>

    <div class="flex flex-1 flex-col p-4">
      <div
        v-if="status === 'idle'"
        class="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-default p-6 text-center text-sm text-muted"
      >
        <UIcon
          name="i-lucide-activity"
          class="size-6 text-dimmed"
        />
        Each step the agent takes appears here: reading, LOINC searches, validation and fixes.
      </div>

      <ol
        v-else
        class="relative space-y-4"
        aria-live="polite"
      >
        <li
          v-for="(step, i) in steps"
          :key="step.id"
          class="relative flex gap-3"
        >
          <span
            v-if="i < steps.length - 1"
            class="absolute start-[13px] top-7 h-[calc(100%-4px)] w-px bg-(--ui-border)"
            aria-hidden="true"
          />
          <span
            class="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border"
            :class="markerClass(step)"
          >
            <UIcon
              :name="step.status === 'running' ? 'i-lucide-loader-circle' : step.status === 'error' ? 'i-lucide-circle-x' : KIND_ICONS[step.kind]"
              class="size-3.5"
              :class="{ 'animate-spin': step.status === 'running' }"
            />
          </span>
          <div class="min-w-0 flex-1 pt-0.5">
            <div class="flex items-baseline gap-2">
              <p
                class="text-sm"
                :class="step.kind === 'search_loinc' ? 'font-mono text-[13px]' : 'font-medium'"
              >
                {{ step.label }}
              </p>
              <span
                v-if="step.durationMs !== undefined"
                class="ms-auto shrink-0 font-mono text-xs tabular-nums text-dimmed"
              >{{ seconds(step.durationMs) }}</span>
            </div>
            <p
              v-if="step.detail"
              class="text-xs text-muted"
            >
              {{ step.detail }}
            </p>
          </div>
        </li>
      </ol>

      <UAlert
        v-if="status === 'error' && error"
        class="mt-4"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Conversion stopped"
        :description="error"
      />

      <dl
        v-if="result"
        class="mt-auto grid grid-cols-3 gap-2 border-t border-default pt-4 text-center"
      >
        <div
          v-for="stat in stats"
          :key="stat.label"
        >
          <dt class="whitespace-nowrap font-mono text-[10px] uppercase tracking-widest text-dimmed">
            {{ stat.label }}
          </dt>
          <dd class="font-display text-2xl text-highlighted">
            {{ stat.value }}
          </dd>
        </div>
      </dl>
    </div>
  </section>
</template>
