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
    '/': { prerender: true },
    // Baseline hardening. No CSP yet: it would need allowances for Nuxt's inline scripts and
    // the LHC-Forms CDN, which loads with Subresource Integrity instead.
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
      }
    }
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
