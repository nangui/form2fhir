<script setup lang="ts">
useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [{ rel: 'icon', href: '/favicon.ico' }],
  htmlAttrs: { lang: 'en' }
})

useSeoMeta({
  title: 'Form2FHIR — any clinical form → a valid FHIR Questionnaire',
  description: 'A Claude agent converts blank clinical forms (text, PDF or image) into FHIR R4 Questionnaires coded in LOINC, and corrects itself until the HL7 validator accepts them.'
})
</script>

<template>
  <UApp>
    <AppHeader />
    <UMain>
      <NuxtPage />
    </UMain>
    <AppFooter />
  </UApp>
</template>
