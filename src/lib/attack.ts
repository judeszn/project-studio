import type { FindingType } from './schema'

// MITRE ATT&CK technique references for finding types, checked by hand against
// attack.mitre.org (Enterprise, ATT&CK v20) on 2026-11-11.
//
// A reference says what ATT&CK calls the activity if an adversary carried it
// out. It is metadata: the page shows it only beside a finding that passes
// every code check, and it never makes a finding, or an incident, confirmed.
// A type gets a technique only when the facts its rule checks are the
// behaviour the technique describes, never because the words look alike.

export interface AttackReference {
  id: string
  name: string
}

// Every type is listed, so a new type needs a decision. null: no technique
// fits on the facts the type records.
export const ATTACK_REFERENCES: Record<FindingType, AttackReference | null> = {
  sign_in_from_unrecognised_device: { id: 'T1078', name: 'Valid Accounts' },
  // An ordinary sign-in or sign-out is not adversary behaviour on its own.
  sign_in: null,
  sign_out: null,
  account_created: { id: 'T1136', name: 'Create Account' },
  // The type does not record whether the change weakened a defence. (T1562,
  // Impair Defenses, now redirects to T1685, Disable or Modify Tools.)
  security_setting_changed: null,
  // Nothing was collected.
  data_access_denied: null,
  // A successful read is not shown to be collection from an information
  // repository in ATT&CK's sense (T1213).
  data_access_succeeded: null,
  account_owner_statement: null,
  other: null,
  // LANL. An account authenticating to a computer is routine on its own;
  // remote-services abuse (T1021) would need more than the logon shows.
  logon: null,
  // A denied logon shows no access, and by owner's decision (2026-11-12) must
  // not be read as an attack.
  denied_logon: null,
}

export const attackUrl = (id: string) => `https://attack.mitre.org/techniques/${id}/`

// Required by ATT&CK's terms of use wherever ATT&CK content is reproduced.
export const ATTACK_NOTICE =
  '© 2026 The MITRE Corporation. This work is reproduced and distributed with the permission of The MITRE Corporation.'
export const ATTACK_TERMS_URL = 'https://attack.mitre.org/resources/legal-and-branding/terms-of-use/'
