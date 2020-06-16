import { Doc } from "./types"

function eqObj(a: {[k: string]: Doc}, b: Doc[] | {[k: string]: Doc}) {
  if (Array.isArray(b)) return false

  for (let k in a) {
    if (!deepEqual(a[k], b[k])) return false
  }
  for (let k in b) {
    if (a[k] === undefined) return false
  }
  return true
}

function eqArr(a: Doc[], b: Doc) {
  if (!Array.isArray(b)) return false
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    if (!deepEqual(a[i], b[i])) return false
  }

  return true
}

export default function deepEqual(a: Doc, b: Doc) {
  // This will cover null, bools, string and number
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false

  return Array.isArray(a) ? eqArr(a, b) : eqObj(a, b)
}
