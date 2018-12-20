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
// op1_ now moves b.x -> b.y, since the contents of a were moved to b

let doc = {a: {x: 5}}
doc = json1.type.apply(doc, op2) // doc = {b: {x: 5, z: 'hi there'}}
doc = json1.type.apply(doc, op1_) // doc = {b: {y: 5, z: 'hi there'}}
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


# Limitations

Your document must only contain pure JSON-stringifyable content. No dates, functions or self-references allowed. Your object should be identical to `JSON.parse(JSON.stringify(obj))`.

Note that this library is currently in preview release. The fuzzer finds convergence bugs in the transform function results after a million or so iterations. So, this code is usable, but it is only 99.9% correct or something. You shouldn't run into these problems in everyday use; but we still need to address them.

There may also be some minor API changes before 1.0, including:

- Flag conflicts when two operations move the same object
- I might rename `applyPath` to something else (`transformCursor` is what the equivalent method is called in the string type, although its a bit of a weird name here). This function also currently doesn't transform anything inside a child edit, and it should.
- Port the whole thing to typescript
- I might expose the full cursor API if this is useful.



## License

Copyright (c) 2013-2015, Joseph Gentle &lt;me@josephg.com&gt;

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

