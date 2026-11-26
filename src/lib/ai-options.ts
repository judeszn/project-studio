import { GoogleAIBackend } from 'firebase/ai'
import type { AIOptions } from 'firebase/ai'

// The options Firebase AI Logic is started with. Kept apart from firebase.ts,
// which starts App Check when imported, so the choice can be tested offline.
//
// Replay protection (audit item H2, 2026-11-26): with limited-use tokens every
// AI request carries a fresh App Check token, so a captured token cannot be
// reused. Off unless a build sets VITE_APPCHECK_LIMITED_USE=true, so that it
// is proven on a preview channel before any production build turns it on.
export function aiOptions(limitedUseSetting: string | undefined): AIOptions {
  return {
    backend: new GoogleAIBackend(),
    useLimitedUseAppCheckTokens: limitedUseSetting === 'true',
  }
}
