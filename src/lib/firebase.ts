import { initializeApp } from 'firebase/app'
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from 'firebase/app-check'
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
// on-device-only inference. Until a real project exists these placeholders let
// the on-device path run; any cloud request made with them is rejected by
// Google, so they cannot produce a cloud answer.
const PLACEHOLDER = {
  apiKey: 'not-configured',
  projectId: 'not-configured',
  appId: 'not-configured',
}

const app = initializeApp(firebaseConfigured ? config : PLACEHOLDER)

const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
export const appCheckConfigured = firebaseConfigured && Boolean(siteKey)

if (appCheckConfigured && siteKey) {
  if (import.meta.env.DEV) {
    // Local development only. Set VITE_APPCHECK_DEBUG_TOKEN in
    // .env.development.local to a token registered in the Firebase console;
    // without it the SDK prints a fresh token to the console to register.
    Object.assign(self, {
      FIREBASE_APPCHECK_DEBUG_TOKEN: import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true,
    })
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  })
}

export const ai = getAI(app, { backend: new GoogleAIBackend() })
