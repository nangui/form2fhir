// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  // Server secrets and limits are read from process.env in server/lib/config.ts,
  // so ANTHROPIC_API_KEY keeps its standard name and is never serialized into the build.
  runtimeConfig: {
    public: {
      repoUrl: '' // NUXT_PUBLIC_REPO_URL
    }
  },

  routeRules: {
    '/': { prerender: true }
  },

  compatibilityDate: '2026-06-30',

  typescript: {
    strict: true
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
