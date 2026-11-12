import { describe, expect, it } from 'vitest'
import { ATTACK_REFERENCES } from './attack'
import { ALL_FINDING_TYPES } from './schema'

describe('ATTACK_REFERENCES', () => {
  it('decides every finding type, and nothing else', () => {
    expect(Object.keys(ATTACK_REFERENCES).sort()).toEqual([...ALL_FINDING_TYPES].sort())
  })

  it('uses technique IDs only', () => {
    for (const ref of Object.values(ATTACK_REFERENCES)) {
      if (ref) expect(ref.id).toMatch(/^T\d{4}(\.\d{3})?$/)
    }
  })

  it('gives no technique where the facts do not show one', () => {
    expect(ATTACK_REFERENCES.data_access_denied).toBeNull()
    expect(ATTACK_REFERENCES.sign_in).toBeNull()
    expect(ATTACK_REFERENCES.sign_out).toBeNull()
    expect(ATTACK_REFERENCES.security_setting_changed).toBeNull()
    expect(ATTACK_REFERENCES.other).toBeNull()
    expect(ATTACK_REFERENCES.logon).toBeNull()
  })
})
