# JSON1 OT Spec

> This is a draft document. Anything here could still change.

The JSON OT type is designed to allow arbitrary concurrent edits in a JSON document. The document must be a tree - no nodes can be repeated. If you serialize the document to JSON and back, it should be identical.

The JSON OT type replaces the JSON0 OT type. Once this type is working, JSON0 will be deprecated. We'll write functions to automatically convert JSON0 ops to JSON ops.

Unlike the [big table of operations](https://github.com/ottypes/json0/blob/master/README.md#summary-of-operations) in JSON0, the new OT type will only support three operation components:

- Pick up subtree
- Place subtree
- Edit embedded object using another OT type.

When you pick up a subtree, it can be placed somewhere else or it could be discarded. When you place a subtree, it can come from somewhere else or it could be an immediate literal value.

The type is designed to contain other embedded OT documents (rich text documents or whatever). The subdocuments can be inserted, deleted or moved around the tree directly by the JSON type. If you want to edit subdocuments, you should use the document's own native OT methods.


## Why? Advantages compared to JSON0

The JSON0 OT type has some weaknesses:

- You can't move an object key or move an item between two different lists
- The semantics for reordering list items is really confusing - and its slightly different depending on whether you're inserting or moving
- JSON0 is O(N*M) if you transform an operation with M components by an operation with N components.
- (Not discussed yet) I want an insert-null operation.
- Doing multiple inserts or multiple removes in a list is quite common, and its quite awkward in JSON0. (You need an operation component for each insert and each remove).

tldr; After a lot of thinking I think we can have a replacement type which is simpler and easier to maintain, faster and more feature rich.


## Operations

The tree is actually a compact form describing three phases:

1. **Pick up phase**: In the pickup phase we take subtrees out of the document. They are either put in a temporary holding area or discarded.
2. **Drop phase**: In the drop phase we insert new subtrees in the document. These subtrees either come from the holding area (from the pickup phase) or they're literal values in the operation.
3. **Edit phase**: In the edit phase we make changes to embedded documents in the tree.

> The timing on the edit phase is sort of weird. The edit can't happen in the middle because we need to be able to express editing a subdocument while moving it. So it needs to be at the start or the end. But it really could be either.

The three phases are all compacted into an operation tree which mirrors the structure of the actual document. I do this because most moves will be local. It doesn't make sense to repeat the walk out to a node in two separate phase sections in the op.

### Some examples.

Given a document of:

    {x:5, y:['happy', 'apple']}

#### Insert z:6:

    {o:{z:{di:6}}}

Translation: Descend into the `o`-bject properties. Decend into key `z`. In the drop phase insert immediate value 6.

#### Rename doc.x to be doc.z:

    {o:{x:{p:0}, z:{d:0}}}

Translation: Descend into the object properties. Pick up the `x` subtree and put it in slot 0. Go to the `z` subtree and place the contents of slot 0.

#### Move x into the list between 'happy' and 'apple'

    {o:{x:{p:0}, y:{l:{1:{d:0}}}}

Translation: Descend into the object properties. Pick up `x` and put it in slot 0. Descend into the list in the y subtree. At position 1, place the item in slot 0.


## Parts of an operation

An operation is a tree. Each node in the tree mirrors a location in the document itself when the operation is being applied. At the root of the tree (and each second level) the tree can have the following keys:

- **o** (object descent): Descend into the object at the current position.
- **l** (list descent): Descend into the list at the current position
- **p** (pickup): During the pickup phase, pick up the subtree from this position and put it in the specified slot. If the slot is null, throw the tree away. Eg `p:10` or `p:null`.
- **d** (drop): During the drop phase, insert the subtree in the specified slot here. Eg `d:10`.
- **di** (drop immediate): During the drop phase, insert the immediate value here. Eg `di:"cabbage"`
- **e** (edit): Apply the specified edit to the subdocument that is here. Eg `e:{type:…, op:…}`

Most nodes simply contain descents into their children, so the tree ends up being this sort of alternating 2 level affair. For example, to pick up `x.y.z` an operation would have `{o:{x:{o:{y:{o:{z:{p:0}}}}}}}`. It feels pretty silly, and I'm sure there's a cleaner answer. I'm doing it this way because its important to know whether we're descending into a list or an object during transform. (And we might descend into both during different phases of the operation if an object is replaced with a list). I'd love some suggestions on better ways to express this.


# Fancier examples

Convert the document {x:10,y:20,z:30} to an array [10,20,30]:

```
{ o: { x: { p: 0 }, y: { p: 1 }, z: { p: 2 } },
  p: null,
  di: [],
  l: { '0': { d: 0 }, '1': { d: 1 }, '2': { d: 2 } } }
```

Rewrite the document {x:{y:{secret:"data"}}} as {y:{x:{secret:"data"}}}:

```
{ o: 
   { x: { o: { y: { p: 0 } } },
     y: { di: { x: {} }, o: { x: { d: 0 } } } } }
```

(Translation: Go into x.y and pick up the data (slot 0). Set doc.y = {}. Set doc.y.x = data (slot 0).)

# Status

I've got the individual map and list transform functions working, but I haven't combined them together. And I also haven't tested it.
