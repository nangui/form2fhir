<script setup lang="ts">
import type { ValidationIssue } from '../../shared/types'
import { groupIssues } from '../utils/questionnaire'

const props = defineProps<{ issues: ValidationIssue[], valid: boolean }>()

const groups = computed(() => groupIssues(props.issues))
</script>

<template>
  <div class="space-y-3">
    <UAlert
      :color="valid ? 'success' : 'error'"
      variant="subtle"
      :icon="valid ? 'i-lucide-shield-check' : 'i-lucide-circle-x'"
      :title="valid ? 'No errors — the HAPI FHIR validator accepts this Questionnaire.' : 'This Questionnaire still has errors.'"
      description="Server checks (LOINC codes, linkIds, answer options) run first, then HAPI FHIR $validate against FHIR R4."
    />

    <ul class="divide-y divide-default rounded-md border border-default">
      <li
        v-for="group in groups"
        :key="`${group.severity}|${group.source}|${group.message}`"
        class="flex gap-3 px-3 py-2.5"
      >
        <UIcon
          :name="group.severity === 'error' ? 'i-lucide-circle-x' : 'i-lucide-triangle-alert'"
          class="mt-0.5 size-4 shrink-0"
          :class="group.severity === 'error' ? 'text-error' : 'text-warning'"
        />
        <div class="min-w-0 flex-1 text-sm">
          <p class="break-words text-default">
            {{ group.message }}
          </p>
          <details
            v-if="group.locations.length"
            class="mt-1 text-xs text-muted"
          >
            <summary class="cursor-pointer select-none">
              {{ group.locations.length === 1 ? group.locations[0] : `${group.locations.length} locations` }}
            </summary>
            <ul
              v-if="group.locations.length > 1"
              class="mt-1 space-y-0.5 font-mono"
            >
              <li
                v-for="location in group.locations"
                :key="location"
              >
                {{ location }}
              </li>
            </ul>
          </details>
        </div>
        <div class="flex shrink-0 items-start gap-1.5">
          <UBadge
            v-if="group.count > 1"
            :label="`×${group.count}`"
            color="neutral"
            variant="soft"
            size="sm"
            class="font-mono"
          />
          <UBadge
            :label="group.source === 'hapi' ? 'HAPI' : 'Server check'"
            color="neutral"
            variant="outline"
            size="sm"
          />
        </div>
      </li>
    </ul>
  </div>
</template>
