<script setup lang="ts">
const { public: { repoUrl } } = useRuntimeConfig()
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-default bg-default/85 backdrop-blur">
    <UContainer class="flex h-14 items-center gap-3">
      <NuxtLink
        to="/"
        class="font-display text-2xl leading-none text-highlighted"
        aria-label="Form2FHIR home"
      >
        Form<span class="text-primary">2</span>FHIR
      </NuxtLink>

      <UBadge
        color="warning"
        variant="subtle"
        class="whitespace-nowrap font-mono text-[10px] uppercase sm:text-[11px] sm:tracking-wide"
      >
        <UIcon
          name="i-lucide-flask-conical"
          class="hidden size-3.5 sm:inline"
        />
        <span class="sm:hidden">Demo · no patient data</span>
        <span class="hidden sm:inline">Demo — no real patient data</span>
      </UBadge>

      <div class="ms-auto flex items-center gap-1">
        <UColorModeButton />
        <UButton
          v-if="repoUrl"
          :to="repoUrl"
          target="_blank"
          icon="i-lucide-github"
          aria-label="Source code on GitHub"
          color="neutral"
          variant="ghost"
        />
      </div>
    </UContainer>
  </header>
</template>
