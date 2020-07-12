# JSON1 OT Spec

The JSON OT type is designed to allow concurrent edits in an arbitrary JSON document.

The JSON1 OT type will replace the JSON0 OT type. I recommend using it over JSON0, although it is less well tested. JSON1 is simpler, faster and more capable in every way compared to JSON0. (And at some point it'd be great to have a tool to automatically convert JSON0 to JSON1 edits.)

Like its predecessor, JSON1 requires that the document is a valid JSON structure. That is:

- Each object or list can only be referenced once in the tree.
- Cycles are not allowed
- The value `undefined` is not allowed anywhere but at the root.
- If you serialize the document to JSON using `JSON.serialize` and back, you should get back an identical document. So, the structure can only contain lists, objects, booleans, nulls, numbers and strings. Functions, maps, sets, dates are all disallowed. (Except through embedded types)

The root of the document can be any valid JSON value (including a string, a number, `true`, `false` or `null`). The document can also be `undefined`. This allows the JSON operations to describe insertions and deletions of the entire document.

Replacing the [big table of operations in JSON0](https://github.com/ottypes/json0/blob/master/README.md#summary-of-operations), JSON1 only supports three essential operation components:

- Pick up subtree (to be moved or discarded)
- Insert subtree (moved from elsewhere, or as a literal copied from the operation)
- Edit embedded object at a location in the subtree using an operation from another registered OT/CRDT type.

The type is designed to contain other embedded OT documents (rich text documents or whatever). The subdocuments can be inserted, deleted or moved around the tree directly by the JSON type. However, if you want to edit subdocuments themselves, you should use the document's own native operations. These operations can be embedded inside a JSON1 operation.

For plain text edits the [text OT type](https://github.com/ottypes/text-unicode) is bundled & always available.


## Why? Advantages compared to JSON0

The JSON0 OT type has some weaknesses:

- You can't move an object key or move an item between two different lists
- The semantics for reordering list items is really confusing - and its slightly different depending on whether you're inserting or moving
- JSON0 is O(N*M) if you transform an operation with M components by an operation with N components.
- JSON0 has no way to safely initialize data before editing
- Doing multiple inserts or multiple removes in a list is quite common, and its quite awkward in JSON0. (You need an operation component for each insert and each remove).
- The new type should support conversion between JSON operations and [JSON Patch (RFC 6902)](https://tools.ietf.org/html/rfc6902). I want those conversions to be bidirectional if possible, although converting embedded custom OT types to JSON Patch won't work.

*tldr;* JSON1 is designed to be simpler and easier to maintain, faster, more feature rich and more widely useful.


## Operations

Operations are expressed in a compact JSON form containing instructions for up to three traversals of the JSON document. The phases are executed on the document in order:

1. **Pick up phase**: In the pickup phase we take subtrees out of the document. They are either put in a temporary holding area or discarded.
2. **Drop phase**: In the drop phase we insert new subtrees in the document. These subtrees either come from the holding area (from the pickup phase) or they're literals embedded in the operation. The drop phase must place every item from the holding area back into the document.
3. **Edit phase**: In the edit phase we make changes to embedded documents in the tree.

Instructions for all three phases are overlaid over the top of one another inside the operation structure.

The operation describes a traversal of the document's tree. The way to interpret the operation is:

- The traversal starts at the root of the document.
- The `[` symbol saves the current location in the document to a stack. (*stack.push(location)*)
- The `]` symbol pops the previously stored location from the stack. (*location = stack.pop()*)
- Strings and numbers inside the operation will descend into the JSON tree using the specified index. Strings are exclusively used to descend into the key of an object, and numbers to descend into a particular index of a list.
- Objects `{...}` contain instructions to be performed at the current location *as the stack is being unwound*. These objects are internally called *operation components*. They can contain instructions:
    - `p` for pick up into storage
    - `r` for remove
    - `d` for drop from storage
    - `i` for insert literal
    - `e` for edit, with accompanying `et` for describing the edit type. `es` / `ena` are shorthands for string and number edits).
  See below for more detail.

Consider this operation, which moves the string at `doc.x` to `doc.y` then edits it:

    [['x', {p:0}], ['y', {d:0, es:[5, 'hi']}]]

This operation contains instructions for all 3 phases:

1. `['x', {p:0}]`: Go to the item at key 'x' inside the document and pick it up, storing it in holding location 0.
2. `['y', {d:0}]`: Go to the key 'y' in the document and place the item in storage location 0.
3. `['y', {es:[5, 'hi']}]`: Go to key 'y' in the document and edit the value using an embedded string edit. (This uses the text-unicode type internally, inserts 'hi' at position 5 in the string.)

When an operation is applied, the phases are executed in sequence. During traversal, any parts of the operation not related to the current phase are ignored.

Just like JSON0 and string edits, when you insert or remove items from a list the list is reordered with no holes. So for example, if you have a list with `[1,2,3]` and discard the second element, the list will become `[1,3]`. If you then insert 5 at the start of the list, the list will become `[5,1,3]`.

There are many equivalent ways the same operation could be written (by wrapping everything with extra [], reordering parts of the traveral, etc). The JSON1 library strictly requires all operations follow some canonicalization rules:

- There are no unnecessary lists `[...]` in the operation. `['x', {r:0}]` rather than `[['x', [{r:0}]]]`.
- The traversal happens in numeric / alphabetic order through all keys. `[['x', {p:0}], ['y', {d:0}]]` rather than `[['y', {d:0}], ['x', {p:0}]]`. When relevent, all list descents should appear before all object descents.
- Components are collapsed when possible. (So, `['x', {r:0, i:1}]` rather than `['x', {r:0}, {i:1}]`).
- Pick up and drop slot identifiers should be numbers counting from 0.
- There are no empty operation components. (`['x', {r:0}]` is valid. `[{}, 'x', {r:0}]` is not.)

Slot identifiers should be ordered within the operation, but this is not strictly enforced in the library.

Constructing operations which follow all these rules in code can be quite tricky. Most users should either:

- Construct complex operations out of simple operations, then use *compose* to merge the simple operations together, or
- Use the *WriteCursor* API to build complex operations. WriteCursor will take care of formatting the operation.

Noop is written as `null`.


### Some examples.

Given a document of:

    {x:5, y:['happy', 'apple']}

#### Insert z:6:

    ['z', {i:6}]

Translation: Descend into key 'z'. In the drop phase insert immediate value 6.

#### Rename (move) doc.x to doc.z:

    [['x', {p:0}], ['z', {d:0}]]

Translation: Descend into the object properties. Pick up the `x` subtree and put it in slot 0. Go to the `z` subtree and place the contents of slot 0.

#### Move x into the list between 'happy' and 'apple'

    [['x',{p:0}], ['y',1,{d:0}]]

Translation: Descend into `x`. Pick up the value and put it in slot 0. Descend into the y subtree. At position 1, place the item in slot 0.


## Parts of an operation

A simple operation is a list of *descents* with some *edit components* at the end. Descents contain strings and numbers, for descending into objects and lists respectively. Edit components are an object describing what to do when we've traversed to the target item in the object.

The edit component object can have one or more of the following values:

- **p** (pickup): During the pickup phase, pick up the subtree from this position and put it in the specified slot. Eg `p:10`.
- **r** (remove): During the pickup phase, remove the subtree at the current position. The value is ignored, but you can store the removed value if you want the op to be invertible.
- **d** (drop): During the drop phase, insert the subtree in the specified slot here. Eg `d:10`.
- **i** (insert): During the drop phase, insert the immediate value here. Eg `i:"cabbage"`
- **e** (edit): Apply the specified edit to the subdocument that is here. Eg `et:'typename', e:<op>`. There are two special cases: You can simply write `es:[...op]` to use the [ot-text-unicode type](https://github.com/ottypes/text-unicode). And you can use `ena:X` to add X to the number at that location in the JSON tree.

Operations can also contain a list of child operations. For example, suppose you want to set `obj.a.x = 1` and `obj.a.y = 2`. You could write an operation:

    [['a', 'x', {i:1}], ['a', 'y', {i:2}]]

For compactness, the common path prefix can be pulled out into the parent list. As such, this is canonically written like this:

    ['a', ['x', {i:1}], ['y', {i:2}]]

You can read this operation as follows:

1. Descend to key `a`
2. At this position, perform the following child operations:
	1. Descend to `x` and insert value `1`
	2. Descend to `y` and insert value `2`


## A note on order

Semantically, each phase of the operation is applied in reverse order, from the deepest parts of the document tree to the shallowest parts. Consider this operation:

    [['x', {p:0}, 'y', {r:true}], ['z', {d:0}]]

The order of operations is:

1. Remove `doc.x.y`
2. Pick up `doc.x` into slot 0
3. Place the contents of slot 0 into `doc.z`.

This rule is important, because it means:

- The path to any pick up or remove operations exactly matches the location in the document before the operation is applied. It doesn't matter if multiple parts of the operation insert / remove other list indexes.
- The path to any drop, insert or edit operations exactly matches the location in the document *after* the operation has been applied.

This lets you (for example) move an item and move its children at the same time, but you need to pick up an item's children relative to the parent's original location and then drop those items relative to the parent's new location.

So given the document `{x: {y: {}}}`, this operation will capitalize the keys (x->X, y->Y):

```
[
  ['x',{p:0},'y',{p:1}],
  ['X',{d:0},'Y',{d:1}]
]
```

Note for *Y* the data is picked up at `x.y` and dropped at `X.Y`.

The operation is carried out in the following order:

- Pick phase:
  1. Descend into *x*
  2. Descend into *y*
  3. Pick up *y* in slot 1, value `{}`
  4. Return. Document is now `{x: {}}`.
  5. Pick up *x* in slot 0, value `{}`
  6. Return. Document is now `{}`.
- Drop phase:
  1. Descend into *X*
  2. Drop data in slot 0 with data `{}`. Document is now `{X: {}}`.
  3. Descend into *Y*
  4. Drop data in slot 1 with value `{}`. Document is now `{X: {Y:{}}}`
  5. Return
  6. Return

Note that the ordering is the same for *drop immediate* (`i:..`) operation components. This allows you to place a new object / array in the document and immediately fill it with stuff moved from elsewhere in the document.


# Fancier examples

Convert the document {x:10,y:20,z:30} to an array [10,20,30]:

```
[
  {r:{},i:[]},
  [0,{d:0}],[1,{d:1}],[2,{d:2}],
  ['x',{p:0}],['y',{p:1}],['z',{p:2}]
]
```

Rewrite the document {x:{y:{secret:"data"}}} as {y:{x:{secret:"data"}}}:

```
[
  ['x', {r:{}}, 'y', {p:0}],
  ['y', {i:{}}, 'x', {d:0}]
]
```

(Translation: Go into x.y and pick up the data (slot 0). Set doc.y = {}. Set doc.y.x = data (slot 0).)


## Initializing data ('set null')

Its quite common to want to initialize data containers on first use. This can cause problems - what happens if another user tries to initialize the data at the same time?

For example, if the two clients try to insert `{tags:['rock']}` and `{tags:['roll']}`, one client's insert will win and the other client's edit would be lost. The document will either contain 'rock' or 'roll', but not both.

In JSON1 the semantics of `insert` are specially chosen to allow this.

The rules are:

- If two concurrent operations insert *identical* content at the same location in an object, they 'both win', and both inserts are kept in the final document.
- Inserts, drops and edits can be embedded inside another insert.

Together, these rules allow clients to concurrently initialize a document without bumping heads. Eg if these two operations are run concurrently:

    [{i:{tags:[]}}, 'tags', 0, {i:'rock'}]

and

    [{i:{tags:[]}}, 'tags', 0, {i:'roll'}]

then the document will end up with the contents `{tags:['rock', 'roll']}`.

This can also be used for collaboratively editing a string that might not exist:

    [{i:'', es:["aaa"]}]

and

    [{i:'', es:["bbb"]}]

Will result in the document containing either "aaabbb" (or "bbbaaa" depending on transform symmetry).


## Inverting operations

The JSON1 OT type allows optional invertible. An operation is invertible if all `r:` components contain the complete contents of any removed data.

In this case, an operation can be inverted by:

- Swapping `i` and `r` components
- Swapping `p` and `d` components
- Moving all edits to the item's source location
- Recursively inverting all embedded edits

The contents of `r:` components is ignored in all other situations outside invert.

Most users should use the builtin `type.invertWithDoc(op, doc) => op'` to invert an operation, using the content of the passed document to provide information on deleted content. The passed document should be a snapshot of the document *before* the operation was applied. (Otherwise removed content will have already been lost!)

Internally invertWithDoc is implemented using two methods:

- `type.makeInvertible(op, doc) => op'`: This method fills in any information missing in `r:` components based on the contents of the passed document.
- `type.invert(op) => op'`: This method inverts an operation, as described above.

But note that information needed to invert an operation is lost when calling *compose* or *transform*.


### Invertible operations and setNull behaviour

Consider this operation from earlier which uses the setNull behaviour to initialize a field, before inserting content into it:

    [{i:'', es:["hi"]}]

Perhaps counterintuitively, the inverse of this operation will be:

    [{r:'hi'}]

Note that this operation will remove both the content, and the entire field that was inserted into. If this is used to undo user edits, this may also remove the edits made by other users.

To work around this issue, it is recommended that the operation be semantically split into the field initialization (`[{i:''}]`) and the user's edit (`[{es: ['hi]}]`). These two parts can be composed, but undoing the user's action should only invert the user's part of that operation.


## Conflicts

There are many ways concurrent changes can incidentally lose user data:

- One user moves data into a location that another user is deleting
- Two concurrent edits move or insert into the same location in a document
- Concurrent edits move items inside one another. (Move A inside B / Move B inside A)

By default, these issues will be resolved automatically by deleting the offending content. This may not be what users want. The JSON1 library allows users to make their own decisions about specificity:

- When simply calling `transform`, any of these issues will throw an exception. (Or `tryTransform`, which returns any conflicts instead of throwing them).
- You can use `transformNoConflict`. This will resolve all of these issues automatically, which may lose user data.
- For more control, `typeAllowingConflictsPred` allows you to specify a predicate function which will be passed any conflicts which occur. The predicate returns true if the library should attempt to automatically resolve the specified conflict.
