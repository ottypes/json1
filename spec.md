# JSON1 OT Spec

> This is a draft document. Anything here could still change.

The JSON OT type is designed to allow arbitrary concurrent edits in a JSON document. The document must be a tree - each object can appear only once in the tree. If you serialize the document to JSON and back, it should be identical.

The JSON1 OT type will replace the JSON0 OT type. Once this type is working, JSON0 will be deprecated. We'll write functions to automatically convert JSON0 ops to JSON1 ops.

Unlike the [big table of operations](https://github.com/ottypes/json0/blob/master/README.md#summary-of-operations) in JSON0, the new OT type will only support essential three operation components:

- Pick up subtree / remove subtree
- Place subtree / insert subtree
- Edit embedded object using an operation from another OT type.

When you pick up a subtree, it can be placed somewhere else or it could be discarded. When you place a subtree, it can come from somewhere else in the document or it could be an immediate literal value.

The type is designed to contain other embedded OT documents (rich text documents or whatever). The subdocuments can be inserted, deleted or moved around the tree directly by the JSON type. However, if you want to edit subdocuments themselves, you should use the document's own native operations, embedded inside a JSON1 operation. The syntax for this hasn't been defined yet, but it'll probably be pretty simple.

> Note: Currently the plan is to use embedded types to edit raw strings, numbers and booleans too. I'll probably make & bundle a simple, officially blessed subtype for each, as well as add some syntax sugar for it.


## Why? Advantages compared to JSON0

The JSON0 OT type has some weaknesses:

- You can't move an object key or move an item between two different lists
- The semantics for reordering list items is really confusing - and its slightly different depending on whether you're inserting or moving
- JSON0 is O(N*M) if you transform an operation with M components by an operation with N components.
- (Not discussed yet) I want an insert-null operation.
- Doing multiple inserts or multiple removes in a list is quite common, and its quite awkward in JSON0. (You need an operation component for each insert and each remove).
- The new type should support conversion between JSON operations and [JSON Patch (RFC 6902)](https://tools.ietf.org/html/rfc6902). I want those conversions to be bidirectional if possible, although converting embedded custom OT types to JSON Patch probably won't work.

tldr; After a lot of thinking I think we can have a replacement type which is simpler and easier to maintain, faster, more feature rich and more widely useful.


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

An operation is a tree. Each node in the tree mirrors a location in the document itself when the operation is being applied. At the root of the tree (and each second level) the tree can have the following keys:

- **p** (pickup): During the pickup phase, pick up the subtree from this position and put it in the specified slot. Eg `p:10`.
- **r** (remove): During the pickup phase, remove the subtree at the current position. The value is ignored, but you can store the removed value if you want the op to be invertible.
- **d** (drop): During the drop phase, insert the subtree in the specified slot here. Eg `d:10`.
- **i** (insert): During the drop phase, insert the immediate value here. Eg `i:"cabbage"`
- **e** (edit): Apply the specified edit to the subdocument that is here. Eg `e:{type:…, op:…}`. Text edits are specialcased to allow you to simply write `es:[...op]` to use the [ot-text type](https://github.com/ottypes/text).

Most nodes simply contain descents into their children, so the tree ends up being this sort of alternating 2 level affair. For example, to pick up `x.y.z` an operation would have `{o:{x:{o:{y:{o:{z:{p:0}}}}}}}`. It feels pretty silly, and I'm sure there's a cleaner answer. I'm doing it this way because its important to know whether we're descending into a list or an object during transform. (And we might descend into both during different phases of the operation if an object is replaced with a list). I'd love some suggestions on better ways to express this.


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


# Status

I've got the individual map and list transform functions working, but I haven't combined them together. And I also haven't tested it.
