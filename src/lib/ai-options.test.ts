import { GoogleAIBackend } from 'firebase/ai'
import { describe, expect, it } from 'vitest'
import { aiOptions } from './ai-options'

// Limited-use App Check tokens stay off unless a build turns them on
// explicitly. Whether the deployed backend accepts them is checked on a
// preview deployment, not here.

describe('Firebase AI Logic options', () => {
  it('use the Gemini Developer API backend', () => {
    expect(aiOptions(undefined).backend).toBeInstanceOf(GoogleAIBackend)
  })

  it('leave limited-use App Check tokens off by default', () => {
    for (const setting of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
      expect(aiOptions(setting).useLimitedUseAppCheckTokens, String(setting)).toBe(false)
    }
  })

  it('turn limited-use App Check tokens on only for the exact setting "true"', () => {
    expect(aiOptions('true').useLimitedUseAppCheckTokens).toBe(true)
  })
})
