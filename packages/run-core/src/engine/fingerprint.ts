import type { AnyWorkflowDefinition } from '../types'

/**
 * Compute a stable fingerprint of a workflow definition's *source*.
 *
 * Used to refuse replay-from-store resumes after a deploy that altered
 * the workflow's code. If the persisted fingerprint doesn't match the
 * currently-loaded definition's, the engine emits
 * `RUN_ERROR { code: 'workflow_version_mismatch' }` rather than blindly
 * driving a fresh generator through a log whose positional indices may
 * no longer line up.
 *
 * The fingerprint covers:
 *   - the workflow's name + its `run` function source
 *   - the workflow's `initialize` function source (if any)
 *
 * Source strings come from `Function.prototype.toString()` — production
 * builds may minify, so the fingerprint is sensitive to whitespace and
 * symbol renaming. That's the conservative choice (Temporal does the
 * same): false-positive mismatches force a redeploy decision rather
 * than silently corrupting an in-flight run.
 *
 * The fingerprint is a 64-bit FNV-1a hash rendered as base36. Crypto
 * strength is not required — we're comparing equality, not resisting
 * collision attacks.
 *
 * Slated for removal in favor of explicit `version` + `previousVersions`
 * routing. Kept for v0 to preserve current engine guarantees.
 */
export function fingerprintWorkflow(workflow: AnyWorkflowDefinition): string {
  // Patch-versioned mode: workflows that declare `patches` opt out of
  // the strict source-hash fingerprint. The fingerprint then covers
  // only the compatibility surface (name + sorted patch list), so
  // code-body changes don't trigger workflow_version_mismatch. The
  // patches-subset check on resume (see run-workflow.ts) enforces
  // that the run's recorded patches are a subset of the current
  // workflow's patches — i.e., we can ADD patches across deploys but
  // not REMOVE them while runs are in flight.
  if (workflow.patches !== undefined) {
    // JSON.stringify gives an unambiguous serialization — joining with a
    // comma would collide between `['a,b']` and `['a', 'b']`.
    const sorted = [...workflow.patches].sort()
    return fnv1a64(
      `patch-versioned:${workflow.name}:${JSON.stringify(sorted)}`,
    )
  }

  const parts: Array<string> = []
  parts.push(`wf:${workflow.name}`)
  parts.push(`run:${workflow.run.toString()}`)
  if (workflow.initialize) {
    parts.push(`init:${workflow.initialize.toString()}`)
  }
  return fnv1a64(parts.join('\x00'))
}

/**
 * 64-bit dispersion hash returned as a base36 string. Used only for
 * workflow source fingerprinting — equality compare across runs of the
 * same definition. Crypto strength is not required; deterministic
 * dispersion that catches code-body changes is.
 *
 * Implementation notes — NOT canonical FNV-1a-64:
 *  - The accumulator is initialized to the canonical 64-bit FNV-1a
 *    offset basis (`0xcbf29ce484222325`), split into a high / low
 *    32-bit pair for JS's lack of u64 bitwise math.
 *  - The multiplier is `0x01000193` (the 32-bit FNV-1a prime), not the
 *    low half of the canonical 64-bit prime. The resulting hash is a
 *    deterministic custom variant, not canonical 64-bit FNV-1a.
 *
 * Stored fingerprints persist on `RunState.fingerprint` and gate
 * replay correctness. Changing the algorithm would invalidate every
 * in-flight run on the next deploy, so this is locked in by
 * backward-compatibility until the engine moves to explicit version
 * routing and the fingerprint check goes away.
 *
 * Per FNV-1a, each byte is XOR-ed into the low half BEFORE the
 * multiply. The multiply diffuses the byte across both halves through
 * the carry term so `hHi` absorbs input.
 */
function fnv1a64(input: string): string {
  const FNV_PRIME_LO = 0x01000193
  let hHi = 0xcbf29ce4
  let hLo = 0x84222325

  // Encode the string as UTF-8 bytes — `charCodeAt` would skip the
  // upper byte of any non-ASCII char, weakening dispersion.
  const bytes = new TextEncoder().encode(input)
  for (const byte of bytes) {
    hLo ^= byte

    const loProduct = hLo * FNV_PRIME_LO
    const newLo = loProduct >>> 0
    const hLoHi16 = (hLo >>> 16) & 0xffff
    const hLoLo16 = hLo & 0xffff
    const carry =
      (Math.imul(hLoHi16, FNV_PRIME_LO) +
        ((Math.imul(hLoLo16, FNV_PRIME_LO) >>> 16) & 0xffff)) >>>
      16
    const newHi =
      (Math.imul(hHi, FNV_PRIME_LO) + ((hLo << 8) >>> 0) + carry) >>> 0
    hLo = newLo
    hHi = newHi
  }
  return hHi.toString(36) + '-' + hLo.toString(36)
}
