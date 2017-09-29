# JSON1 OT Spec

The JSON OT type is designed to allow concurrent edits in an arbitrary JSON document.

The JSON1 OT type will replace the JSON0 OT type. Once this type is working, I recommend everyone uses it instead of JSON0. We'll write functions to automatically convert JSON0 ops to JSON1 ops. JSON1 is simpler, faster and more capable in every way compared to JSON0.

Like its predecessor, JSON1 requires that the document is a valid JSON structure. That is:

- Each object can appear only once in the tree
- Cycles are not allowed
- The value `undefined` is not allowed anywhere but the root.
- If you serialize the document to JSON and back, you should get back an identical document.

The root of the document can be any valid JSON value (including a string, a number, `true`, `false` or `null`). The document can also be `undefined`. This allows the JSON operations to describe insertions and deletions of the entire document.

Replacing the [big table of operations in JSON0](https://github.com/ottypes/json0/blob/master/README.md#summary-of-operations), JSON1 only supports three essential operation components:

- Pick up subtree / remove subtree
- Place subtree / insert subtree
- Edit embedded object using an operation from another OT type.

When you pick up a subtree, it can be placed somewhere else or it could be discarded. When you place a subtree, it can come from somewhere else in the document or it could be an immediate literal value.

The type is also designed to contain other embedded OT documents (rich text documents or whatever). The subdocuments can be inserted, deleted or moved around the tree directly by the JSON type. However, if you want to edit subdocuments themselves, you should use the document's own native operations. These operations can be embedded inside a JSON1 operation.

For plain text edits the [text OT type](https://github.com/ottypes/text) is bundled & always available.

> Note: Currently the plan is to use embedded types to edit raw numbers and booleans too. I'll probably make & bundle a simple, officially blessed subtype for each, as well as add some syntax sugar for it.


## Why? Advantages compared to JSON0

The JSON0 OT type has some weaknesses:

- You can't move an object key or move an item between two different lists
- The semantics for reordering list items is really confusing - and its slightly different depending on whether you're inserting or moving
- JSON0 is O(N*M) if you transform an operation with M components by an operation with N components.
- JSON0 has no way to safely initialize data before editing
- Doing multiple inserts or multiple removes in a list is quite common, and its quite awkward in JSON0. (You need an operation component for each insert and each remove).
- The new type should support conversion between JSON operations and [JSON Patch (RFC 6902)](https://tools.ietf.org/html/rfc6902). I want those conversions to be bidirectional if possible, although converting embedded custom OT types to JSON Patch won't work.

*tldr;* After a lot of thinking I think we can have a replacement type which is simpler and easier to maintain, faster, more feature rich and more widely useful.


## Operations

The tree is actually a compact form describing three phases. Conceptually, the phases are executed on the document in order:

1. **Pick up phase**: In the pickup phase we take subtrees out of the document. They are either put in a temporary holding area or discarded.
2. **Drop phase**: In the drop phase we insert new subtrees in the document. These subtrees either come from the holding area (from the pickup phase) or they're literals in the operation. The drop phase must place every item from the holding area back into the document.
3. **Edit phase**: In the edit phase we make changes to embedded documents in the tree.

The operation itself looks like a single traversal, but the traversal is actually executed multiple times. During the pick up phase, we only look at pick ups & removes. During the drop phase we only look at drops and inserts, and during the edit phase we only look at edits.

Just like JSON0, when you edit a list, the list is spliced. So for example, if you have a list with `[1,2,3]` and discard the second element, the list will become `[1,3]`. If you then insert 5 at the start of the list, the list will become `[5,1,3]`. If you don't want this behaviour, use an object.



### Some examples.

Given a document of:

    {x:5, y:['happy', 'apple']}

#### Insert z:6:

    ['z', {i:6}]

Translation: Descend into key 'z'. In the drop phase insert immediate value 6.

#### Rename doc.x to be doc.z:


    [['x',{p:0}], ['z',{d:0}]]

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
- **e** (edit): Apply the specified edit to the subdocument that is here. Eg `e:{type:…, op:…}`. Text edits are specialcased to allow you to simply write `es:[...op]` to use the [ot-text type](https://github.com/ottypes/text).

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

The pickup phase does a post-order traversal of the tree (items are picked up after traversing the children) and the drop phase does a pre-order traversal (items are dropped before traversing into the children). This lets you move an item and move its children at the same time, but you need to pick up an item's children relative to the parent's original location and drop them relative to the parent's new location.

For example, given the document `{x: {y: {}}}`, this operation will capitalize the keys (x->X, y->Y):

```
[
  ['x',{p:0},'y',{p:1}],
  ['X',{d:0},'Y',{d:1}]
]
```

Note that for *Y* the data is picked up at `x.y` and dropped at `X.Y`.

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

Note that the ordering is the same for *drop immediate* (`di:..`) operation components. This allows you to place a new object / array in the document and immediately fill it with stuff moved from elsewhere in the document.


# Fancier examples

Convert the document {x:10,y:20,z:30} to an array [10,20,30]:

```
[
  {r:{},i:[]},
  ['x',{p:0}],['y',{p:1}],['z',{p:2}],
  [0,{d:0}],[1,{d:1}],[2,{d:2}]
]
```

Rewrite the document {x:{y:{secret:"data"}}} as {y:{x:{secret:"data"}}}:

```
[
  ['x',[{r:{}}, ['y', {p:0}]]],
  ['y',[{i:{}}, ['x', {d:0}]]]
]
```

(Translation: Go into x.y and pick up the data (slot 0). Set doc.y = {}. Set doc.y.x = data (slot 0).)

---

# Common issues and questions

## Initializing data ('set null')

Its quite common to want to initialize data on first use. This can cause problems - what happens if another user tries to initialize the data at the same time?

If the two clients try to insert `{tags:['rock']}` and `{tags:['roll']}`, one client's insert will win and the other client's edit would be lost. The document will either contain 'rock' or 'roll', but not both.

In JSON0 there is no solution to this problem. In JSON1 the semantics of `insert` are specially chosen to allow this.

The rules are:

- If two identical inserts happen, they 'both win', and both inserts are kept in the final document.
- Inserts, drops and edits can be embedded inside another insert.

Together, these rules allow clients to concurrently initialize a document without bumping heads. Eg if these two operations are run concurrently:

    [{i:{tags:[]}}, 'tags', 0, {i:'rock'}]

and

    [{i:{tags:[]}}, 'tags', 0, {i:'roll'}]

then the document will end up with the contents `{tags:['rock', 'roll']}`.

This also works with editing:

    [{i:'', es:["aaa"]}]

and

    [{i:'', es:["bbb"]}]

Will result in the document containing either "aaabbb" or "bbbaaa" depending on transform symmetry.


## Inverting operations

The JSON1 OT type is designed to be optionally invertible. There are no constraints on the content of `r:` components, so the contents of the removed elements can be placed there.

To implement this, we need a (unwritten) function which takes an operation and a document snapshot and augments all `r:X` components with the content to be removed.

Then an invert function can be written which:

- Swaps `i` and `r` components
- Swaps `p` and `d` components
- Move all edits to the item's source location
- Invert all embedded edits using the embedded type

In the current implementation the extra information in `r:X` components will be lost if the operation is transformed.


> **Add information about conflicts**

> **Add information about the lost and found list**