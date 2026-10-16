<script setup lang="ts">
import type { ConvertResult } from '../../shared/types'

const props = defineProps<{
  status: 'idle' | 'running' | 'done' | 'error'
  result?: ConvertResult
  coverage?: { coded: number, total: number }
}>()

const tabs = computed(() => {
  const coverage = props.coverage
  const errors = props.result?.issues.filter(i => i.severity === 'error').length ?? 0
  return [
    { label: 'Preview', icon: 'i-lucide-eye', slot: 'preview' as const },
    { label: 'JSON', icon: 'i-lucide-braces', slot: 'json' as const },
    { label: 'Codes', icon: 'i-lucide-list-checks', slot: 'codes' as const, badge: coverage ? `${coverage.coded}/${coverage.total}` : undefined },
    { label: 'Validation', icon: 'i-lucide-shield-check', slot: 'validation' as const, badge: errors ? { label: String(errors), color: 'error' as const } : undefined }
  ]
})
</script>

<template>
  <section class="flex flex-col rounded-lg border border-default bg-default">
    <PaneLabel
      index="03"
      title="FHIR Questionnaire"
    >
      <ValidStamp
        v-if="result?.valid"
        :key="result.durationMs"
      />
      <UBadge
        v-else-if="result"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-x"
        :label="`Not valid after ${result.iterations} Claude calls`"
        class="whitespace-nowrap"
      />
    </PaneLabel>

    <div class="flex flex-1 flex-col p-4">
      <UTabs
        v-if="result"
        :items="tabs"
        variant="link"
        :unmount-on-hide="false"
        :ui="{ list: 'overflow-x-auto', trigger: 'shrink-0', content: 'pt-4' }"
      >
        <template #preview>
          <QuestionnairePreview :questionnaire="result.questionnaire" />
        </template>
        <template #json>
          <JsonCode :value="result.questionnaire" />
        </template>
        <template #codes>
          <CodesTable
            :questionnaire="result.questionnaire"
            :coverage="coverage ?? { coded: 0, total: 0 }"
          />
        </template>
        <template #validation>
          <ValidationIssues
            :issues="result.issues"
            :valid="result.valid"
          />
        </template>
      </UTabs>

      <div
        v-else-if="status === 'running'"
        class="space-y-3"
        aria-hidden="true"
      >
        <USkeleton class="h-8 w-1/2" />
        <USkeleton class="h-5 w-3/4" />
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-10 w-11/12" />
      </div>

      <div
        v-else
        class="flex min-h-64 flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-default p-6 text-center text-sm text-muted"
      >
        <UIcon
          name="i-lucide-file-check"
          class="size-6 text-dimmed"
        />
        <p>The validated Questionnaire appears here, with a live preview, its JSON, the LOINC codes and the validator report.</p>
      </div>
    </div>
  </section>
</template>
