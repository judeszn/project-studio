import { initializeApp } from 'firebase/app'
import { CustomProvider, ReCaptchaEnterpriseProvider, initializeAppCheck } from 'firebase/app-check'
import { GoogleAIBackend, getAI } from 'firebase/ai'

// Read each variable as `import.meta.env.NAME`, never through an alias of
// `import.meta.env`: aliasing makes Vite inline the whole env object, debug
// token included, into the production bundle.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId)

// The AI SDK refuses to build a model without apiKey/projectId/appId, even for
// on-device-only inference. Without a real config these placeholders let the
// on-device path run; any cloud request made with them is rejected by Google,
// so they cannot produce a cloud answer.
const PLACEHOLDER = {
  apiKey: 'not-configured',
  projectId: 'not-configured',
  appId: 'not-configured',
}

const app = initializeApp(firebaseConfigured ? config : PLACEHOLDER)

const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY

export type AppCheckMode =
  | 'debug token (development build)'
  | 'reCAPTCHA Enterprise'
  | 'not initialised'

// Firebase AI Logic refuses cloud requests that carry no valid App Check
// token. On-device inference needs no token.
function startAppCheck(): AppCheckMode {
  if (!firebaseConfigured) return 'not initialised'
  if (import.meta.env.DEV) {
    // Local development only. The SDK exchanges a debug token for an App Check
    // token and never calls the provider. With `true` it makes a token once,
    // keeps it in this browser and prints it to the console, to be registered
    // in the Firebase console. To reuse one token, set
    // VITE_APPCHECK_DEBUG_TOKEN in .env.development.local (never .env.local).
    Object.assign(self, {
      FIREBASE_APPCHECK_DEBUG_TOKEN: import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true,
    })
    // A provider that issues nothing: localhost is never added to a reCAPTCHA
    // key's allowed domains, so only a registered debug token works here.
    const noAttestation = new CustomProvider({
      getToken: () => Promise.reject(new Error('No App Check attestation provider in development.')),
    })
    initializeAppCheck(app, { provider: noAttestation, isTokenAutoRefreshEnabled: true })
    return 'debug token (development build)'
  }
  if (!siteKey) return 'not initialised'
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  })
  return 'reCAPTCHA Enterprise'
}

export const appCheckMode = startAppCheck()

export const ai = getAI(app, { backend: new GoogleAIBackend() })
