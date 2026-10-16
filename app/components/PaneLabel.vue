<script setup lang="ts">
defineProps<{ index: string, title: string }>()
</script>

<template>
  <header class="flex min-h-12 items-center gap-3 border-b border-default px-4">
    <span class="font-mono text-xs text-primary">{{ index }}</span>
    <h2 class="truncate font-mono text-xs font-medium uppercase tracking-widest text-highlighted">
      {{ title }}
    </h2>
    <div class="ms-auto flex shrink-0 items-center gap-2">
      <slot />
    </div>
  </header>
</template>
