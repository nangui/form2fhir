<script setup lang="ts">
import type { ItemSource } from '../../shared/types'
import { listCodes } from '../utils/questionnaire'

const props = defineProps<{ questionnaire: unknown, sources: ItemSource[], coverage: { coded: number, total: number } }>()

const rows = computed(() => listCodes(props.questionnaire))
const sourceOf = computed(() => new Map(props.sources.map(source => [source.linkId, source])))
const percent = computed(() => (props.coverage.total ? Math.round((props.coverage.coded / props.coverage.total) * 100) : 0))
</script>

<template>
  <div>
    <p class="mb-3 text-sm text-muted">
      <span class="font-medium text-highlighted">{{ coverage.coded }} of {{ coverage.total }}</span>
      questions coded in LOINC ({{ percent }}%). Every code comes from a live LOINC search in this run.
    </p>
    <div class="overflow-x-auto rounded-md border border-default">
      <table class="w-full text-left text-sm">
        <thead class="bg-muted font-mono text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <th class="px-3 py-2 font-medium">
              linkId
            </th>
            <th class="px-3 py-2 font-medium">
              LOINC
            </th>
            <th class="px-3 py-2 font-medium">
              Display
            </th>
            <th class="px-3 py-2 font-medium">
              Form text
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <!-- Keyed by position: linkIds come from the model and may be empty or duplicated. -->
          <tr
            v-for="(row, i) in rows"
            :key="i"
          >
            <td class="px-3 py-2 align-top font-mono text-xs text-toned">
              {{ row.linkId }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 align-top font-mono text-xs">
              <a
                v-if="row.code"
                :href="`https://loinc.org/${row.code}`"
                target="_blank"
                rel="noopener"
                class="text-primary underline-offset-2 hover:underline"
              >{{ row.code }}</a>
              <span
                v-else
                class="text-dimmed"
              >not coded</span>
            </td>
            <td class="px-3 py-2 align-top text-xs text-default">
              {{ row.display || row.text }}
            </td>
            <td class="px-3 py-2 align-top text-xs text-toned">
              <template v-if="sourceOf.get(row.linkId)">
                <q>{{ sourceOf.get(row.linkId)!.excerpt }}</q>
                <span
                  v-if="sourceOf.get(row.linkId)!.found === false"
                  class="ml-1 text-warning"
                >(not found in the pasted text)</span>
              </template>
              <span
                v-else
                class="text-dimmed"
              >none given</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
