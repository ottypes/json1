# JSON1

> Status: Preview release. Usable; but contains known bugs. See below.

This is an operational transformation type for arbitrary JSON trees. It supports concurrently editing arbitrarily complex nested structures. Fancy features:

- Support for arbitrarily moving objects in the JSON tree. You could, for example, implement [workflowy](https://workflowy.com) using this, allowing items to be collaboratively moved around and edited. Or Maya. Or google wave 2. Or ... Anything!
- Supports embedded subtypes. For example, you can embed rich text documents using quilljs or something inside your JSON tree
- Conflicts! Unlike CRDTs, this library can be configured to refuse to accept operations which would result in lost data. For example, if two users both insert into the same location, instead of silently choosing a winner arbitrarily, you can throw an exception and tell the user whats going on.

This code it is written to replace [ottypes/json0](https://github.com/ottypes/json0). JSON1 implements a superset of JSON0's functionality.

The spec for operations is in [spec.md](spec.md).


## Usage

The JSON library has 2 main APIs:

- The core OT API, which is a type with standard `apply`, `compose`, `transform`, etc functions. The standard API for this is [documented here](https://github.com/ottypes/docs). This is exposed via `require('ot-json').type`.
- A simple API for creating operations.

```javascript
const json1 = require('ot-json1')

const op1 = json1.moveOp(['a', 'x'], ['a', 'y'])

// The easiest way to make compound operations is to just compose smaller operations
const op2 = [
  json1.moveOp(['a'], ['b']),
  json1.insertOp(['b', 'z'], 'hi there')
].reduce(json1.type.compose, null)

// op2 = [['a', {p:0}], ['b', {d:0}, 'x', {i: 'hi there'}]]

const op1_ = json1.type.transform(op1, op2, 'left')
// op1_ now moves b.x -> b.y instead, because op2 moved 'a' to 'b'.

let doc = {a: {x: 5}}
doc = json1.type.apply(doc, op2) // doc = {b: {x: 5, z: 'hi there'}}
doc = json1.type.apply(doc, op1_) // doc = {b: {y: 5, z: 'hi there'}}


// Using the CP1 diamond property, this is the same as:

doc = {a: {x: 5}}
doc = json1.type.apply(doc, op1) // doc = {a: {y: 5}}
const op2_ = json1.type.transform(op2, op1, 'right')
doc = json1.type.apply(doc, op2) // doc = {b: {y: 5, z: 'hi there'}}
```

### Standard operation creation functions

- `json1.removeOp(path, value?)`: Remove the value at the specified path. Becomes `[...path, {r: value | true}]`
- `json1.moveOp(fromPath, toPath)`: Moves the value at `fromPath` to `toPath`.
- `json1.insertOp(path, value)`: Insert the specified value at the specified path
- `json1.replaceOp(path, oldVal, newVal)`: Replace the object at path with `newVal`. If you don't care about invertibility, pass `true` for oldVal.
- `json1.editOp(path, subtype, op)`: Modify the value at the specified path `op`, using JSON type `subtype`. The type must be registered first using `json1.type.registerSubtype(typeObj)`. Eg, `json1.type.registerSubtype(require('rich-text'))`. It can be specified using the type name, the type URI or the type object. The [unicode text](https://github.com/ottypes/text-unicode) type and the simple number add type (TODO documentation) are registered by default.

These functions all return very simple operations. The easiest way to make more complex operations is to combine these pieces using `compose`. For example:

```javascript
const op = [
  json1.insertOp([], {title: '', contents: '', public: false}),
  json1.editOp(['title'], 'text-unicode', ['My cool blog entry']),
  json1.replaceOp(['public', false, true])
].reduce(json1.type.compose, null)
```

### Conflicts

> TODO: Describe how this works and how conflict handling is configured


## Interoperability with JSON0

This library supports a superset of the capabilities of JSON0, but the two types have some important differences:

- JSON0 notably doesn't support moves between object keys
- JSON0 doesn't support moving child values from one object to another
- JSON0 and JSON1 use different embedded string types. JSON1 uses [text-unicode](https://github.com/ottypes/text-unicode) which uses proper unicode offsets. JSON0 uses the older [text](https://github.com/ottypes/text) type which uses UTF16 pair offsets. These are normally the same, but notably differ when embedding emoji characters.

You can convert JSON0 operations to JSON1 operations using [json0-to-1](https://github.com/ottypes/json0-to-1). This is a work in progress and doesn't currently support converting string values. Please make noise & consider helping out if this conversion code is important to you. This conversion code guarantees that `json1.apply(doc, convert(json0_op)) === json0.apply(doc, json0_op)` but this invariant is not true through transform. `json1.transform(convert(op1), convert(op2)) !== convert(json0.transform(op1, op2))` in some cases due to slightly different handling of conflicting list indexes.


# Limitations

Your document must only contain pure JSON-stringifyable content. No dates, functions or self-references allowed. Your object should be identical to `JSON.parse(JSON.stringify(obj))`.

Note that this library is currently in preview release. In practical terms, this means:

- The fuzzer finds convergence bugs in the transform function results after a million or so iterations. So, this code is usable, but there are some [extremely complex operations](https://github.com/ottypes/json1/blob/4a0741d402ca631710e4e27f4f34647954c1f7d8/test/test.coffee#L2230-L2246) that this library currently struggles with. You shouldn't run into any of these problems in everyday use.
- There may also be some reasonably minor API changes before 1.0
- `applyPath` doesn't currently transform cursors inside an edited string document
- `applyPath` doesn't currently have fuzzer tests. There are probably a couple bugs there that the fuzzer will find as soon as we hook it up.
- `applyPath` may be renamed to something else (`transformCursor` is what the equivalent method is called in the string type, although its a bit of a weird name here). This function also currently doesn't transform anything inside a child edit, and it should.
- We're missing a conflict for situations when two operations both move the same object to different locations. Currently the left operation will silently 'win' and the other operation's move will be discarded. But this behaviour should be user configurable
- I want the whole library ported to typescript once its correct
- I haven't exposed the internal cursor API, which is used internally to traverse operations. I'd be happy to expose this if someone provides a good, clear use case for doing so.



## License

Copyright (c) 2013-2018, Joseph Gentle &lt;me@josephg.com&gt;

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

