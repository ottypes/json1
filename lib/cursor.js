// This file exposes a cursor interface for iterating over an operation.
//
// The cursor interface supports both reading and writing (appending).

const assert = require('assert')
const log = require('./log')

const EMPTY_LIST = []

const isObject = o => (o && typeof o === 'object' && !Array.isArray(o))

const isGreaterKey = (a, b) => (
  // All the numbers, then all the letters. Just as the gods of ascii intended.
  (typeof a === typeof b) ?
    a > b : typeof a === 'string' && typeof b === 'number'
)

function makeCursor(op = null) {
  // Each time we descend we store the parent and the index of the child. The
  // indexes list is appended twice each time we descend - once with the last
  // key index of the parent, and once with the index of the array we're
  // descending down.
  const parents = []
  const indexes = []
  
  // The index of the last listy child we visited for write cursors. This is used
  // to ensure we are traversing the op in order.
  let lcIdx = -1

  // The way we handle the root of the op is a big hack - its like that because
  // the root of an op is different from the rest; it can contain a component
  // immediately.
  // Except at the root (which could be null), container will always be a list.
  let container = op
  let idx = -1

  // This is used internally, below, for cloning read cursors.
  const init = (_container, _idx) => {
    parents.length = indexes.length = 0
    container = _container
    idx = _idx
  }

  const ascend = () => {
    assert.equal(parents.length, indexes.length / 2)

    if (idx === 0) {
      if (parents.length) {
        lcIdx = indexes.pop()
        container = parents.pop()
        idx = indexes.pop()
      } else {
        lcIdx = 0
        idx = -1
      }
    } else {
      idx--
      if (isObject(container[idx])) idx--
    }
  }

  // TODO: Consider splitting this out into two cursor functions.
  // Exactly one of read() or write() should be called to share the context
  // variables above. Its weird.. I could use inheritance to share the code
  // above, but thats sort of gross too.
  return {
    read() {
      return {
        _init: init, // Internal.
        ascend,

        // Its only valid to call this after descending into a child.
        getKey() {
          return container[idx]
        },

        getComponent() {
          let c
          if (container && container.length > idx + 1 && isObject((c = container[idx + 1]))) {
            return c
          } else {
            return null
          }
        },

        descendFirst() {
          let i = idx + 1

          // Only valid to call this if hasChildren() returns true.
          if (!container
              || i >= container.length
              || (isObject(container[i]) && (i + 1) >= container.length)) {
            return false
          }

          if (isObject(container[i])) i++ // Skip component
          let firstChild = container[i]

          if (Array.isArray(firstChild)) {
            indexes.push(idx)
            parents.push(container)
            indexes.push(i)
            idx = 0
            container = firstChild
          } else {
            idx = i
          }
          return true
        },

        nextSibling() {
          assert.equal(parents.length, indexes.length / 2)
          // Children are inline or we're at the root
          if (idx > 0 || parents.length === 0) return false

          const i = indexes[indexes.length - 1] + 1
          const c = parents[parents.length - 1]
          if (i >= c.length) return false // Past the end of the listy children.

          assert(!isNaN(i))
          indexes[indexes.length - 1] = i
          container = c[i]
          // idx = 0 but it should be zero anyway.
          return true
        },

        clone() {
          const c = makeCursor(null).read()
          c._init(container, idx)
          return c
        },

        _print(prefix) {
          // TODO: Clean this up for the browser.
          const inspect = require('util').inspect
          const c = this.getComponent()
          if (c) console.log(`${prefix}${inspect(c, {depth: 2, colors: true})}`)

          // TODO: Rewrite me using eachChild, below.
          if (!this.descendFirst()) return

          do {
            const k = this.getKey()
            console.log(`${prefix}${k}`)
            this._print(prefix + '  ')
          } while (this.nextSibling())

          this.ascend()
        },

        print() { this._print('') },

        eachChild: function(fn) {
          if (!this.descendFirst()) return

          do fn(this.getKey())
          while (this.nextSibling())

          this.ascend()
        }
      }
    },

    write() {
      const pendingDescent = []

      function flushDescent() {
        assert.equal(parents.length, indexes.length / 2)

        if (container === null) op = container = []

        for (let j = 0; j < pendingDescent.length; j++) {
          const k = pendingDescent[j]
          let i = idx + 1

          // Skip the component here, if any.
          if (i < container.length && isObject(container[i])) i++

          assert(i === container.length || !isObject(container[i]))

          if (i === container.length) {
            // Just append a child here.
            container.push(k)
            idx = i

          } else if (container[i] === k) {
            // Traverse right...
            idx = i

          } else {
            if (!Array.isArray(container[i])) {
              // Its not an array. Its not the same as me. I must have a new child!
              const oldChild = container.splice(i, container.length - i)
              container.push(oldChild)
            }

            indexes.push(idx)
            parents.push(container)

            if (lcIdx !== -1) {
              assert(isGreaterKey(k, container[lcIdx][0]))
              i = lcIdx + 1
              lcIdx = -1
            }

            // Skip until k.
            while (i < container.length && isGreaterKey(k, container[i][0])) i++

            indexes.push(i)
            idx = 0
            if (i < container.length && container[i][0] === k) {
              container = container[i]
            } else {
              // Insert a new child and descend into it.
              const child = [k]
              container.splice(i, 0, child)
              container = child
            }
          }
        }
        pendingDescent.length = 0
      }

      return {
        reset: () => { lcIdx = -1 },

        // Creates and returns a component, creating one if need be. You should
        // probably write to it immediately - ops are not valid with empty
        // components.
        getComponent() {
          flushDescent()

          const i = idx + 1
          if (i < container.length && isObject(container[i])) {
            return container[i]
          } else {
            const component = {}
            container.splice(i, 0, component)
            return component
          }
        },

        write(key, value) { this.getComponent()[key] = value },

        get() { return op },

        descend(key) { pendingDescent.push(key) },

        ascend() {
          if (pendingDescent.length) pendingDescent.pop()
          else ascend()
        },

        mergeTree(data) {
          if (data === null) return
          assert(Array.isArray(data))

          // Backup our position...
          const _lcIdx = lcIdx

          let depth = 0
          for (let i = 0; i < data.length; i++) {
            const c = data[i]
            if (typeof c === 'string' || typeof c === 'number') {
              depth++
              this.descend(c)
            } else if (Array.isArray(c)) {
              this.mergeTree(c)
            } else if (typeof c === 'object') {
              for (let k in c) this.write(k, c[k])
            }
          }

          // And reset.
          while (depth--) this.ascend()
          lcIdx = _lcIdx
        }
      }
    }
  }
}

// Note that makeCursor above isn't exported. All usage goes through these
// wrappers.
const writeCursor = exports.writeCursor = op => makeCursor(op).write()
const readCursor = exports.readCursor = op => makeCursor(op).read()

// This is an externally driven iterator for cursors.
exports.advancer = function(c, listMap, listAdvance) {
  let didDescend, valid
  valid = didDescend = c && c.descendFirst()

  // Advance to key k.
  function adv(k) {
    let k2
    while (valid) {
      let skip = false
      k2 = c.getKey()

      if (listMap && typeof k2 === 'number') {
        k2 = listMap(k2, c.getComponent())
        if (k2 < 0) {
          k2 = -k2 - 1
          skip = true
        }
      }
      //log('advancer', fn._name, k, k2)
      if (isGreaterKey(k2, k) || (!skip && k === k2)) break
      if (listAdvance && typeof k2 === 'number') listAdvance(k2, c.getComponent())

      valid = c.nextSibling()
    }

    return (valid && k === k2) ? c : null
  }

  adv.end = () => { if (didDescend) c.ascend() }
  return adv
}

// Walk two cursors together.
exports.eachChildOf = function(c1, c2, listMap1, listMap2, fn) {
  let hasChild1, descended1, hasChild2, descended2
  hasChild1 = descended1 = c1 && c1.descendFirst()
  hasChild2 = descended2 = c2 && c2.descendFirst()

  while (hasChild1 || hasChild2) {
    let k1 = hasChild1 ? c1.getKey() : null
    let k2 = hasChild2 ? c2.getKey() : null

    if (listMap1 && typeof k1 === 'number') k1 = listMap1(k1)
    if (listMap2 && typeof k2 === 'number') k2 = listMap2(k2)

    if (k1 !== null && k2 !== null) {
      if (isGreaterKey(k2, k1)) {
        k2 = null
      } else if (k1 !== k2) {
        k1 = null
      }
    }

    // fn(key, c1 or null, c2 or null)
    fn((k1 === null ? k2 : k1),
      (k1 !== null ? c1 : null),
      (k2 !== null ? c2 : null)
    )

    if (k1 !== null && hasChild1) hasChild1 = c1.nextSibling()
    if (k2 !== null && hasChild2) hasChild2 = c2.nextSibling()
  }

  if (descended1) c1.ascend()
  if (descended2) c2.ascend()
}

