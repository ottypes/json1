// This file exposes a cursor interface for iterating over an operation.
//
// The cursor interface supports both reading and writing (appending).

// const log = require('./log')
const log = () => {}
const assert = (pred, msg) => {if (!pred) throw new Error(msg)}

const isObject = o => (o && typeof o === 'object' && !Array.isArray(o))

const isGreaterKey = (a, b) => (
  // All the numbers, then all the letters. Just as the gods of ascii intended.
  (typeof a === typeof b) ?
    a > b : typeof a === 'string' && typeof b === 'number'
)

const copyAll = (c, w) => {
  for (let k in c) w.write(k, c[k])
}

function makeCursor(op = null) {
  // Each time we descend we store the parent and the index of the child. The
  // indexes list is appended twice each time we descend - once with the last
  // key index of the parent, and once with the index of the array we're
  // descending down.
  let parents = []
  let indexes = []

  // The index of the last listy child we visited for write cursors. This is used
  // to ensure we are traversing the op in order.
  let lcIdx = -1

  // The way we handle the root of the op is a big hack - its like that because
  // the root of an op is different from the rest; it can contain a component
  // immediately.
  // Except at the root (which could be null), container will always be a list.
  let container = op
  let idx = -1

  // ONLY USED FOR WRITE. Kind of gross having this here.
  let pendingDescent

  // This is used internally, below, for cloning read cursors.
  const init = (_container, _idx, _parents, _indexes) => {
    // parents.length = indexes.length = 0
    container = _container
    idx = _idx

    // Only need these for getPath()
    parents = _parents.slice()
    indexes = _indexes.slice()
  }

  const ascend = () => {
    assert(parents.length === indexes.length / 2)

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
      assert(idx > 0)
      idx--
      if (isObject(container[idx])) idx--
    }
  }

  const getPath = () => {
    const path = []
    let c = container
    let p = parents.length - 1
    let i = idx
    while (i >= 0) {
      path.unshift(c[i])
      if (i === 0) {
        i = indexes[p*2]
        c = parents[p--]
      } else {
        i -= isObject(c[i-1]) ? 2 : 1
      }
    }
    return path
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
        getPath,

        get() { return container ? container.slice(idx + 1) : null },

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
          assert(parents.length === indexes.length / 2)
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
          c._init(container, idx, parents, indexes)
          return c
        },

        // _print(prefix) {
        //   // TODO: Clean this up for the browser.
        //   const inspect = require('util').inspect
        //   const c = this.getComponent()
        //   if (c) console.log(`${prefix}${inspect(c, {depth: 2, colors: true})}`)

        //   for (const k of this.children()) {
        //     console.log(`${prefix}${k}`)
        //     this._print(prefix + '  ')
        //   }
        // },

        // print() { this._print('') },

        *children() {
          if (!this.descendFirst()) return

          // do if (yield this.getKey()) break
          do yield this.getKey()
          while (this.nextSibling())

          ascend()
        },
        
        // It'd be really nice to do this using generators.
        traverse(w, fn) {
          const c = this.getComponent()
          if (c) fn(c, w)

          for (const key of this.children()) {
            if (w) w.descend(key)
            this.traverse(w, fn)
            if (w) w.ascend()
          }
        },

        eachPick(w, fn) {
          this.traverse(w, (c, w) => { if (c.p != null) fn(c.p, w) })
        },
        eachDrop(w, fn) {
          this.traverse(w, (c, w) => { if (c.d != null) fn(c.d, w) })
        },
      }
    },

    write() {
      pendingDescent = []

      function flushDescent() {
        assert(parents.length === indexes.length / 2)

        if (container === null) op = container = []

        for (let j = 0; j < pendingDescent.length; j++) {
          const k = pendingDescent[j]
          // log('fd', k)
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
              // log('bundle inside', i, lcIdx)
              const oldChild = container.splice(i, container.length - i)
              container.push(oldChild)
              if (lcIdx > -1) lcIdx = i
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
              // log('-> container', container)
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

        write(key, value) {
          const component = this.getComponent()
          assert(component[key] == null || component[key] === value,
            'Internal consistency error: Overwritten component. File a bug')
          component[key] = value
        },

        get() { return op },

        descend(key) {
          // log('descend', key)
          pendingDescent.push(key)
        },

        descendPath(path) {
          pendingDescent.push(...path)
          return this
        },

        ascend() {
          if (pendingDescent.length) pendingDescent.pop()
          else ascend()
        },

        mergeTree(data, mergeFn = copyAll) {
          if (data === null) return
          assert(Array.isArray(data))
          if (data === op) throw Error('Cannot merge into my own tree')

          // Backup our position...
          const _lcIdx = lcIdx
          const oldDepth = parents.length

          let depth = 0
          for (let i = 0; i < data.length; i++) {
            const c = data[i]
            if (typeof c === 'string' || typeof c === 'number') {
              depth++
              this.descend(c)
            } else if (Array.isArray(c)) {
              this.mergeTree(c, mergeFn)
            } else if (typeof c === 'object') {
              mergeFn(c, this)
            }
          }

          // And reset.
          while (depth--) this.ascend()

          // We might have had pending descents that we've flushed out. Reset
          // to the start of the descent.
          lcIdx = (parents.length === oldDepth) ? _lcIdx : -1
        },

        at(path, fn) {
          this.descendPath(path)
          fn(this)
          for (let i = 0; i < path.length; i++) this.ascend()
          return this
        },

        // This is used by helpers, so the strict ordering guarantees are
        // relaxed.
        writeAtPath(path, key, value) {
          this.at(path, () => this.write(key, value))

          // Allows for multiple writeAtPath calls to relax ordering.
          this.reset()
          return this
        },

        writeMove(path1, path2, slot = 0) {
          return this
            .writeAtPath(path1, 'p', slot)
            .writeAtPath(path2, 'd', slot)
        },

        getPath() {
          const path = getPath()
          path.push(...pendingDescent)
          return path
        },
      }
    }
  }
}

// Note that makeCursor above isn't exported. All usage goes through these
// wrappers.
const writeCursor = exports.writeCursor = op => makeCursor(op).write()
const readCursor = exports.readCursor = op => makeCursor(op).read()

// onSkipped is called for any children of r which are never returned by adv.
exports.advancer = function(r, listMap, listAdv) {
  let didDescend, valid
  // Could use r.children() here instead... though this is might be simpler.
  valid = didDescend = r && r.descendFirst()

  // Advance to key k. If k is null, advance all the way to the end.
  // let last = undefined
  function adv(ktarget) {
    // if (last === ktarget) throw Error('duplicate descent')
    // last = ktarget
    let k2_
    while (valid) {
      const k2 = k2_ = r.getKey()

      if (ktarget != null) {
        let skip = false
        if (listMap && typeof k2 === 'number') {
          k2_ = listMap(k2, r.getComponent())
          if (k2_ < 0) {
            k2_ = ~k2_
            skip = true
          }
        }

        // 3 cases:
        // - ktarget > k2. onSkip and iterate.
        // - ktarget = k and !skip. return r
        // - ktarget = k and skip or ktarget < k2. stop.
        
        if (isGreaterKey(k2_, ktarget)) return
        else if (k2_ === ktarget && !skip) return r
      }

      // Skip this item and continue.
      if (listAdv && typeof k2 === 'number') listAdv(k2_, r.getComponent())
      valid = r.nextSibling()
    }
  }

  adv.end = () => {
    // Advance to the end of the child items. Technically onlny needed if onSkipped is defined
    if (didDescend) r.ascend()
  }
  return adv
}

// Walk two cursors together.
exports.eachChildOf = function(r1, r2, fn) {
  let hasChild1, descended1, hasChild2, descended2
  hasChild1 = descended1 = r1 && r1.descendFirst()
  hasChild2 = descended2 = r2 && r2.descendFirst()

  while (hasChild1 || hasChild2) {
    let k1 = hasChild1 ? r1.getKey() : null
    let k2 = hasChild2 ? r2.getKey() : null

    if (k1 !== null && k2 !== null) {
      // Use the smallest key
      if (isGreaterKey(k2, k1)) k2 = null
      else if (k1 !== k2) k1 = null
    }

    // fn(key, r1 or null, r2 or null)
    fn((k1 == null ? k2 : k1),
      (k1 != null ? r1 : null),
      (k2 != null ? r2 : null)
    )

    if (k1 != null && hasChild1) {
      hasChild1 = r1.nextSibling()
    }
    if (k2 != null && hasChild2) {
      hasChild2 = r2.nextSibling()
    }
  }

  if (descended1) r1.ascend()
  if (descended2) r2.ascend()
}
