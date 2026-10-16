<template>
  <footer class="mt-12 border-t border-default bg-default">
    <UContainer class="space-y-2 py-6 text-xs leading-relaxed text-muted">
      <p class="font-medium text-toned">
        Demo only. Use blank forms — never real patient data. Not a medical device; no clinical decision support.
      </p>
      <p>
        Form content is sent to Claude (Anthropic), the NLM Clinical Tables API and the public HAPI FHIR test server.
      </p>
      <p>
        This material contains content from
        <ULink
          to="https://loinc.org"
          target="_blank"
          class="underline"
        >LOINC</ULink>.
        LOINC is copyright © Regenstrief Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC)
        Committee and is available at no cost under the license at
        <ULink
          to="https://loinc.org/license"
          target="_blank"
          class="underline"
        >loinc.org/license</ULink>.
        LOINC searches use the NLM Clinical Tables API.
      </p>
      <p>FHIR® is the registered trademark of HL7 and is used with the permission of HL7.</p>
      <p class="font-mono uppercase tracking-widest text-dimmed">
        Built with Claude API
      </p>
    </UContainer>
  </footer>
</template>
