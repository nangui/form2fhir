<script setup lang="ts">
const { status, steps, result, coverage, error, convert } = useConvert()
</script>

<template>
  <UContainer class="py-6 lg:py-8">
    <section class="mb-6 max-w-4xl">
      <h1 class="font-display text-4xl leading-[1.05] text-highlighted lg:text-[2.75rem]">
        Any clinical form <span class="text-primary">→</span> a valid FHIR Questionnaire.
      </h1>
      <p class="mt-3 max-w-2xl text-sm text-muted sm:text-base">
        Paste a blank form or upload a PDF or screenshot. A Claude agent drafts a FHIR R4 Questionnaire coded in LOINC,
        then fixes it until the HAPI FHIR validator accepts it.
      </p>
      <p class="mt-3 font-mono text-[11px] uppercase tracking-widest text-dimmed">
        The model proposes · the validator decides
      </p>
    </section>

    <!-- min-w-0: long JSON lines must scroll inside their pane, not widen the grid. -->
    <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-12 *:min-w-0">
      <InputPane
        class="lg:col-span-4"
        :busy="status === 'running'"
        @convert="convert"
      />
      <TracePane
        class="lg:col-span-3 lg:min-h-[38rem]"
        :status="status"
        :steps="steps"
        :result="result"
        :coverage="coverage"
        :error="error"
      />
      <OutputPane
        class="lg:col-span-5 lg:min-h-[38rem]"
        :status="status"
        :result="result"
        :coverage="coverage"
      />
    </div>
  </UContainer>
</template>
