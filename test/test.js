/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// Unit tests for the JSON1 OT type.
//
// These tests are quite unstructured. You can see the skeletons of a few
// organizing systems, but ultimately there's just lots of test cases to run.
//
// Cleanups welcome, so long as you don't remove any tests.

const assert = require('assert');
// {type} = require '../index'
const {type} = require('../lib/json1');
const log = require('../lib/log');
const deepClone = require('../lib/deepClone');

const {transform} = type;
const {DROP_COLLISION, RM_UNEXPECTED_CONTENT, BLACKHOLE} = type;

const apply = function({doc:snapshot, op, expect}) {
  type.setDebug(false);

  const orig = deepClone(snapshot);
  try {
    const result = type.apply(snapshot, op);
    assert.deepStrictEqual(snapshot, orig, 'Original snapshot was mutated');
    return assert.deepStrictEqual(result, expect);
  } catch (e) {
    console.log(`Apply failed! Repro apply( ${JSON.stringify(snapshot)}, ${JSON.stringify(op)} )`);
    console.log(`expected output: ${JSON.stringify(expect)}`);
    throw e;
  }
};

const d = function(fn) {
  type.setDebug(true);
  fn();
  return type.setDebug(false);
};

const compose = function({op1, op2, expect}) {
  try {
    const result = type.compose(op1, op2);
    return assert.deepStrictEqual(result, expect);
  } catch (e) {
    d(function() {
      console.error('FAIL! Repro with:');
      console.log(`compose( ${JSON.stringify(op1)}, ${JSON.stringify(op2)} )`);
      console.log(`expected output: ${JSON.stringify(expect)}`);
      return type.compose(op1, op2);
    });
    throw e;
  }
};

const invConflict = ({type, op1, op2}) => ({type, op1:op2, op2:op1});



const otherSide = function(side) { if (side === 'left') { return 'right'; } else { return 'left'; } };
const checkConflict = function({op1, op2, side, conflict: expectConflict, expect}) {
  // We should get the same conflict with xf(op1, op2, left) and xf(op2, op1, right).
  if (expectConflict != null) {
    if (!expectConflict.op1) { expectConflict.op1 = type.normalize(op1); }
    if (!expectConflict.op2) { expectConflict.op2 = type.normalize(op2); }
  }

  return (() => {
    const result = [];
    for (var [side_, op1_, op2_, ec] of [
        [side, op1, op2, expectConflict],
        [otherSide(side), op2, op1, expectConflict ? invConflict(expectConflict) : null]
      ]) {
      try {

        // d -> log('tryTransform', side_, op1_, op2_)
        const {ok, conflict} = type.tryTransform(op1_, op2_, side_);
        if ((ec == null)) {
          // We don't care what the result is here; just that it doesn't conflict.
          result.push(assert(ok));
        } else {
          assert(!ok, `Conflict erroneously succeeded (${side_})`);
          // d -> log('conflict', conflict)
          conflict.op1 = type.normalize(conflict.op1);
          conflict.op2 = type.normalize(conflict.op2);
          result.push(assert.deepStrictEqual(conflict, ec));
        }
      } catch (e) {
        d(function() {
          console.error('FAIL! Repro with:');
          console.log(`tryTransform(${JSON.stringify(op1_)}, ${JSON.stringify(op2_)}, '${side_}')`);
          return type.tryTransform(op1_, op2_, side_);
        });
        throw e;
      }
    }
    return result;
  })();
};

const xf = function({op1, op2, conflict, conflictLeft, conflictRight, expect, expectLeft, expectRight}) {
  if (expect !== undefined) { expectLeft = (expectRight = expect); }
  if (conflict !== undefined) { conflictLeft = (conflictRight = conflict); }

  return (() => {
    const result1 = [];
    for (var [side, e, c] of [['left', expectLeft, conflictLeft], ['right', expectRight, conflictRight]]) {
      checkConflict({op1, op2, side, conflict: c, expect: e});

      try {
        const result = (c != null) ? type.transformNoConflict(op1, op2, side) : transform(op1, op2, side);
        result1.push(assert.deepStrictEqual(result, e));
      } catch (error) {
        e = error;
        d(function() {
          console.error('FAIL! Repro with:');
          return console.log(`transform(${JSON.stringify(op1)}, ${JSON.stringify(op2)}, '${side}')`);
        });
          // if c? then type.transformNoConflict op1, op2, side else transform op1, op2, side
        throw e;
      }
    }
    return result1;
  })();
};



const diamond = function({doc, op1, op2}) {
  let doc1, doc12, doc2, doc21, op1_, op2_;
  type.setDebug(false);

  try {
    // Test that the diamond property holds
    op1_ = transform(op1, op2, 'left');
    op2_ = transform(op2, op1, 'right');

    doc1 = type.apply(doc, op1);
    doc2 = type.apply(doc, op2);

    doc12 = type.apply(doc1, op2_);
    doc21 = type.apply(doc2, op1_);

    return assert.deepStrictEqual(doc12, doc21);
  } catch (e) {
    log.quiet = false;
    log('\nOops! Diamond property does not hold. Given document', doc);
    log('op1 ', op1, '   /    op2', op2);
    log('op1_', op1_, '   /    op2_', op2_);
    log('---- 1');
    log('op1', op1, '->', doc1);
    log('op2', op2_, '->', doc12);
    log('---- 2');
    log('op2', op2, '->', doc2);
    log('op1', op1_, '->', doc21);
    log('----------');
    log(doc12, '!=', doc21);
    throw e;
  }
};


const path = function(path, {op, expect}) {
  if (expect === undefined) { expect = path.slice(); }

  const result = type.transformPosition(path, op);
  assert.deepStrictEqual(result, expect);

  // Also check that path+X = expect+X
  const path2 = path.concat('x');
  const expect2 = (expect != null) ? expect.concat('x') : null;
  
  const result2 = type.transformPosition(path2, op);
  return assert.deepStrictEqual(result2, expect2);
};


describe('json1', function() {
  before(function() {
    type.registerSubtype(require('ot-simple'));
    return type.setDebug(true);
  });
  after(() => type.setDebug(false));

  describe('checkOp', function() {
    const pass = function(op) {
      try {
        return type.checkValidOp(op);
      } catch (e) {
        console.log(`FAIL! Repro with:\ncheckOp( ${JSON.stringify(op)} )`);
        throw e;
      }
    };

    const fail = function(op) {
      try {
        return assert.throws(() => type.checkValidOp(op));
      } catch (e) {
        console.log(`FAIL! Repro with:\ncheckOp( ${JSON.stringify(op)} )`);
        console.log('Should throw!');
        throw e;
      }
    };

    it('allows some simple valid ops', function() {
      pass(null);
      pass([{i:[1,2,3]}]);
      pass([{r:{}}]);
      pass([['x',{p:0}], ['y',{d:0}]]);
      pass([[0,{p:0}], [10,{d:0}]]);
      pass([['a',{p:0}],['b',{d:0}],['x',{p:1}],['y',{d:1}]]);
      pass([{e:"hi", et:'simple'}]);
      pass([{es:["hi"]}]);
      return pass([{ena:5}]);
  });

    it('disallows invalid syntax', function() {
      fail(undefined);
      fail({});
      fail("hi");
      fail(true);
      fail(false);
      fail(0);
      fail(10);
      fail([{}]);
      fail([{invalid:true}]);
      fail([10, {}]);
      fail([10, {invalid:true}]);
      return fail([10, 'hi']);
  });

    it('throws if there is any empty leaves', function() {
      fail([]);
      fail(['x']);
      fail(['x', {}]);
      fail(['x', []]);
      fail([10]);
      fail([10, {}]);
      return fail([10, []]);
  });

    it('ensures path components are non-zero integers or strings', function() {
      fail([-1, {r:{}}]);
      fail([0.5, {r:{}}]);
      fail([true, {r:{}}]);
      fail([false, {r:{}}]);
      fail([null, {r:{}}]);
      return fail([undefined, {r:{}}]);
  });

    it('does not allow two pickups or two drops in a component', function() {
      fail([{p:0, r:{}}]);
      fail([{p:1, r:{}}]);
      fail(['x', {p:0, r:{}}]);
      fail(['x', {p:1, r:{}}]);

      fail([{d:0, i:'hi'}]);
      fail([{d:1, i:'hi'}]);
      fail([10, {d:0, i:'hi'}]);
      return fail([10, {d:1, i:'hi'}]);
  });

    it('throws if there are mismatched pickups / drops', function() {
      fail([{p:0}]);
      fail([{d:0}]);
      fail(['x', {p:0}]);
      fail([10, {p:0}]);
      fail(['x', {d:0}]);
      return fail([10, {d:0}]);
  });

    it('throws if pick/drop indexes dont start at 0', function() {
      fail([['x', {p:1}], ['y', {d:1}]]);
      return fail([[10, {p:1}], [20, {d:1}]]);
  });

    it('throws if a descent starts with an edit', () => fail([10, [{i:"hi"}]]));

    it('throws if descents are out of order', function() {
      fail(['x', ['b', {r:{}}], ['a', {r:{}}]]);
      fail(['x', [10, {r:{}}], [5, {r:{}}]]);
      fail(['x', ['a', {r:{}}], [5, {r:{}}]]);
      fail(['x', ['a', {r:{}}], ['a', {r:{}}]]);
      return fail(['x', [10, {r:{}}], [10, {r:{}}]]);
  });

    it('throws if descents start with the same scalar', () => fail(['x', ['a', {r:{}}], ['a', {e:{}}]]));

    it('throws if descents have two adjacent edits', function() {
      fail([{r:{}}, {p:0}]);
      fail(['x', {r:{}}, {p:0}]);
      return fail(['x', {r:{}}, {p:0}, 'y', {r:{}}]);
  });

    it.skip('does not allow ops to overwrite their own inserted data', function() {
      fail([{i:{x:5}}, 'x', {i:6}]);
      return fail([{i:['hi']}, 0, {i:'omg'}]);
  });

    it.skip('does not allow immediate data directly parented in other immediate data', function() {
      fail([{i:{}}, 'x', {i:5}]);
      fail([{i:{x:5}}, 'x', 'y', {i:6}]);
      return fail([{i:[]}, 0, {i:5}]);
  });

    it('does not allow the final item to be a single descent', () => fail(['a', ['b', {r:{}}]])); // It should be ['a', 'b', r:{}]

    it('does not allow anything after the descents at the end', function() {
      fail([[1, {r:{}}], [2, {r:{}}], 5]);
      fail([[1, {r:{}}], [2, {r:{}}], 5, {r:{}}]);
      return fail([[1, {r:{}}], [2, {r:{}}], {r:{}}]);
  });

    it('allows removes inside removes', function() {
      pass(['x', {r:true}, 'y', {r:true}]);
      pass(['x', {r:{}}, 'y', {r:true}]);
      pass([['x', {r:true}, 'y', {p:0}, 'z', {r:true}], ['y', {d:0}]]);
      return pass([['x', {r:{}}, 'y', {p:0}, 'z', {r:true}], ['y', {d:0}]]);
  });

    it('allows inserts inside inserts', function() {
      pass([1, {i:{}}, 'x', {i:10}]);
      return pass([[0, 'x', {p:0}], [1, {i:{}}, 'x', {d:0}, 'y', {i:10}]]);
  });

    it.skip('fails if the operation drops items inside something it picked up', function() {
      fail(['x', {r:true}, 1, {i:'hi'}]);
      fail(['x', {d:0}, 1, {p:0}]);
      return fail([{r:true}, 1, {p:0, d:0}]);
  });

    return describe('edit', function() {
      it('requires all edits to specify their type', function() {
        fail([{e:{}}]);
        fail([5, {e:{}}]);
        return pass([{e:{}, et:'simple'}]);
    });

      it('allows edits to have null or false for the operation', function() {
        // These aren't valid operations according to the simple type, but the
        // type doesn't define a checkValidOp so we wouldn't be able to tell
        // anyway.
        pass([{e:null, et:'simple'}]);
        pass([5, {e:null, et:'simple'}]);
        pass([{e:false, et:'simple'}]);
        return pass([5, {e:false, et:'simple'}]);
    });

      it('does not allow an edit to use an unregistered type', function() {
        fail([{e:{}, et:'an undefined type'}]);
        return fail([{e:null, et:'an undefined type'}]);
    });

      it('does not allow two edits in the same operation', function() {
        fail([{e:{}, et:'simple', es:[1,2,3]}]);
        fail([{es:[], ena:5}]);
        return fail([{e:{}, et:'simple', ena:5}]);
    });

      it('fails if the type is missing', () => fail([{et:'missing', e:{}}]));

      it('does not allow anything inside an edited subtree');

      it.skip('does not allow an edit inside removed or picked up content', function() {
        fail([{r:true}, 1, {es:['hi']}]);
        pass([1, {r:true}, 1, {es:['hi']}]);
        fail(['x', {r:true}, 1, {es:['hi']}]);
        pass([[1, {p:0}, 1, {es:['hi']}], [2, {d:0}]]);
        fail([['x', {p:0}, 1, {es:['hi']}], ['y', {d:0}]]);

        // This is actually ok.
        return pass([ 0, { p: 0 }, [ 'a', { es: [], r: true } ], [ 'x', { d: 0 } ] ]);
    });

      return it.skip('does not allow you to drop inside something that was removed', function() {
        // These insert into the next list item
        pass([[1, {r:true}, 1, {d:0}], [2, {p:0}]]);
        pass([1, {p: 0}, 'x', {d: 0}]);

        // But this is not ok.
        return fail(['x', {p:0}, 'a', {d:0}]);
    });
  });
});

  describe('normalize', function() {
    const n = function(opIn, expect) {
      if (expect === undefined) { expect = opIn; }
      const op = type.normalize(opIn);
      return assert.deepStrictEqual(op, expect);
    };

    it('does the right thing for noops', function() {
      n(null);
      return n([], null);
    });

    it('normalizes some regular ops', function() {
      n([{i:'hi'}]);
      n([{i:'hi'}, 1,2,3], [{i:'hi'}]);
      n([[1,2,3, {p:0}], [1,2,3, {d:0}]], [1,2,3, {p:0, d:0}]);
      n([[1,2,3, {p:0}], [1,2,30, {d:0}]], [1,2, [3, {p:0}], [30, {d:0}]]);
      return n([[1,2,30, {p:0}], [1,2,3, {d:0}]], [1,2, [3, {d:0}], [30, {p:0}]]);
  });

    it('will let you insert null', () => n([{i:null}]));

    it('normalizes embedded ops when available', function() {
      n([{es:[0, 'hi']}], [{es:['hi']}]);
      n([{et:'text-unicode', e:['hi']}], [{es:['hi']}]);
      n([{et:'text-unicode', e:[0, 'hi']}], [{es:['hi']}]);
      n([{et:'simple', e:{}}]);
      n([{et:'number', e:5}], [{ena:5}]);
      return n([{ena:5}]);
  });

    it.skip('normalizes embedded removes', function() {
      n([1, {r:true}, 2, {r:true}], [1, {r:true}]);
      return n([{r:true}, 2, {r:true}], [{r:true}]);
  });

    it('throws if the type is missing', () =>
      // Not sure if this is the best behaviour but ... eh.
      assert.throws(() => n([{et:'missing', e:{}}]))
  );

    return it('corrects weird pick and drop ids', () => n([['x', {p:1}], ['y', {d:1}]], [['x', {p:0}], ['y', {d:0}]]));
});

// ****** Apply ******

  describe('apply', function() {
    it('Can set properties', function() {
      apply({
        doc: [],
        op: [0, {i:17}],
        expect: [17]});

      return apply({
        doc: {},
        op: ['x', {i:5}],
        expect: {x:5}});
  });

    it('can edit the root', function() {
      apply({
        doc: {x:5},
        op: [{r:true}],
        expect: undefined
      });

      apply({
        doc: '',
        op: [{r:true}],
        expect: undefined
      });

      apply({
        doc: 'hi',
        op: [{r:true, i:null}],
        expect: null
      });

      apply({
        doc: 'hi',
        op: [{es:[2, ' there']}],
        expect: 'hi there'
      });

      assert.throws(() => type.apply(null, [{i:5}]));

      apply({
        doc: undefined,
        op: [{i:5}],
        expect: 5
      });

      return apply({
        doc: {x:5},
        op: [{r:{}, i:[1,2,3]}],
        expect: [1,2,3]});
  });

      // TODO: And an edit of the root.

    it('can move 1', () => apply({
      doc: {x:5},
      op: [['x', {p:0}], ['y', {d:0}]],
      expect: {y:5}}) );

    it('can move 2', () => apply({
      doc: [0,1,2],
      op: [[1, {p:0}], [2, {d:0}]],
      expect: [0,2,1]}) );

    it('can handle complex list index stuff', () => apply({
      doc: [0,1,2,3,4,5],
      op: [[1, {r:{}, i:11}], [2, {r:{}, i:12}]],
      expect: [0,11,12,3,4,5]}) );

    it('correctly handles interspersed descent and edits', () => apply({
      doc: {x: {y: {was:'y'}, was:'x'}},
      op: [['X',{d:0},'Y',{d:1}], ['x',{p:0},'y',{p:1}]],
      expect: {X: {Y: {was:'y'}, was:'x'}}}) );

    it('can edit strings', () => apply({
      doc: "errd",
      op: [{es:[2,"maghe"]}],
      expect: "ermagherd"
    })
     );

    it('can edit numbers', () => apply({
      doc: 5,
      op: [{ena:10}],
      expect: 15
    })
     );

    it('can edit child numbers', () => apply({
      doc: [20],
      op: [0, {ena:-100}],
      expect: [-80]}) );

    it('can edit subdocuments using an embedded type', () => apply({
      doc: {str:'hai'},
      op: [{e:{position:2, text:'wai'}, et:'simple'}],
      expect: {str:'hawaii'}}) );

    it('applies edits after drops', () => apply({
      doc: {x: "yooo"},
      op: [['x', {p:0}], ['y', {d:0, es:['sup']}]],
      expect: {y: "supyooo"}}) );

    it('throws when the op traverses missing items', function() {
      assert.throws(() => type.apply([0, 'hi'], [1, {p:0}, 'x', {d:0}]));
      return assert.throws(() => type.apply({}, [{p:0}, 'a', {d:0}]));
  });

    return it('throws if the type is missing', () => assert.throws(() => type.apply({}, [{et:'missing', e:{}}])));
});


  describe('apply path', function() {
    it('does not modify path when op is unrelated', function() {
      path(['a', 'b', 'c'], {op: null});
      path(['a', 'b', 'c'], {op: ['x', {i:5}]});
      path(['a', 'b', 'c'], {op: ['x', {r:true}]});
      path(['a', 'b', 'c'], {op: [['x', {p:0}], ['y', {d:0}]]});
      path([1,2,3], {op: [2, {i:5}]});
      path([1,2,3], {op: [1, 2, 4, {i:5}]});
      path([1], {op: [1, 2, {r:true}]});
      return path(['x'], {op: ['x', 'y', {r:true}]});
  });

    it('adjusts list indicies', function() {
      path([2], {op: [1, {i:5}], expect: [3]});
      path([2], {op: [2, {i:5}], expect: [3]});
      path([2], {op: [1, {r:true}], expect: [1]});
      path([2], {op: [[1, {p:0}], [3, {d:0}]], expect: [1]});
      path([2], {op: [[1, {d:0}], [3, {p:0}]], expect: [3]});
      return path([2], {op: [[2, {d:0}], [3, {p:0}]], expect: [3]});
  });

    it('returns null when the object at the path was removed', function() {
      path(['x'], {op: [{r:true}], expect: null});
      path(['x'], {op: ['x', {r:true}], expect: null});
      path([1], {op: [{r:true}], expect: null});
      return path([1], {op: [1, {r:true}], expect: null});
    });

    it('moves the path', function() {
      path(['a', 'z'], {op: [['a', {p:0}], ['y', {d:0}]], expect: ['y', 'z']});
      path(['a', 'b'], {op: [['a', 'b', {p:0}], ['z', {d:0}]], expect: ['z']});
      path(['a', 'b'], {op: [['a', 'b', 'c', {p:0}], ['z', {d:0}]]});
      path([1,2], {op: [[1, {p:0}], [10, {d:0}]], expect: [10, 2]});
      path([1,2], {op: [[1, 2, {p:0}], [10, {d:0}]], expect: [10]});
      path([1,2], {op: [1, [1, {d:0}], [2, {p:0}]], expect: [1, 1]});
      return path([1,2], {op: [[1, 2, 3, {p:0}], [10, {d:0}]]});
  });

    it('handles pick parent and move', () => path(['a', 'b', 'c'], {op: [['a', {r:true}, 'b', {p:0}], ['x', {d:0}]], expect: ['x', 'c']}));

    it('adjusts indicies under a pick', () => path(['a', 'b', 10], {op: [['a', {p:0}, 'b', 1, {r:true}], ['x', {d:0}]], expect: ['x', 'b', 9]}));

    it.skip('gen ops', function() {});
      // This should do something like:
      // - Generate a document
      // - Generate op, a random operation
      // - Generate a path to somewhere in the document and an edit we can do there -> op2
      // - Check that transform(op2, op) == op2 at transformPosition(path) or something like that.

    return it('calls transformPosition with embedded string edits if available', function() {
      // For embedded string operations (and other things that have
      // transformPosition or transformPosition or whatever) we should call that.
      path(['x','y','z', 1], {op: ['x','y','z', {es:['abc']}], expect: ['x','y','z', 4]});
      path(['x','y','z', 1], {op: ['x','y','z', {es:['💃']}], expect: ['x','y','z', 2]});
      return path(['x','y','z'], {op: ['x','y','z', {es:['💃']}], expect: ['x','y','z']});
  });
});


// ******* Compose *******

  describe('compose', function() {
    it('composes empty ops to nothing', () => compose({
      op1: null,
      op2: null,
      expect: null
    })
     );

    describe('op1 drop', function() {
      it('vs remove', () => compose({
        op1: [['x', {p:0}], ['y', {d:0}]],
        op2: ['y', {r:true}],
        expect: ['x', {r:true}]}) );

      it('vs remove parent', () => compose({
        op1: [['x', {p:0}], ['y', 0, {d:0}]],
        op2: ['y', {r:true}],
        expect: [['x', {r:true}], ['y', {r:true}]]}) );

      it('vs remove child', () => compose({
        op1: [['x', {p:0}], ['y', {d:0}]],
        op2: ['y', 'a', {r:true}],
        expect: [['x', {p:0}, 'a', {r:true}], ['y', {d:0}]]}) );

      it('vs remove and pick child', () => compose({
        op1: [['x', {p:0}], ['y', {d:0}]],
        op2: [['y', {r:true}, 'a', {p:0}], ['z', {d:0}]],
        expect: [['x', {r:true}, 'a', {p:0}], ['z', {d:0}]]}) );

      it('vs pick', () => compose({
        op1: [['x', {p:0}], ['y', {d:0}]],
        op2: [['y', {p:0}], ['z', {d:0}]],
        expect: [['x', {p:0}], ['z', {d:0}]]}) );

      return it('is transformed by op2 picks', () => compose({
        op1: [['x', {p:0}], ['y', 10, {d:0}]],
        op2: ['y', 0, {r:true}],
        expect: [['x', {p:0}], ['y', [0, {r:true}], [9, {d:0}]]]}) );
  });

    describe('op1 insert', function() {
      it('vs remove', () => compose({
        op1: ['x', {i:{a:'hi'}}],
        op2: ['x', {r:true}],
        expect: null
      })
       );

      it('vs remove parent', () => compose({
        op1: ['x', 0, {i:{a:'hi'}}],
        op2: ['x', {r:true}],
        expect: ['x', {r:true}]}) );

      it('vs remove child', () => compose({
        op1: ['x', {i:{a:'hi', b:'woo'}}],
        op2: ['x', 'a', {r:true}],
        expect: ['x', {i:{b:'woo'}}]}) );

      it('vs remove and pick child', () => compose({
        op1: ['x', {i:{a:'hi', b:'woo'}}],
        op2: [['x', {r:true}, 'a', {p:0}], ['y', {d:0}]],
        expect: ['y', {i:'hi'}]}) );

      it('vs remove an embedded insert', () => compose({
        op1: ['x', {i:{}}, 'y', {i:'hi'}],
        op2: ['x', 'y', {r:true}],
        expect: ['x', {i:{}}]}) );

      it('vs remove from an embedded insert', () => compose({
        op1: ['x', {i:{}}, 'y', {i:[1,2,3]}],
        op2: ['x', 'y', 1, {r:true}],
        expect: ['x', {i:{}}, 'y', {i:[1, 3]}]}) );

      it('picks the correct element of an embedded insert', () => compose({
        op1: ['x', {i:['a', 'b', 'c']}, 1, {i:'XX'}],
        op2: [['x', 1, {p:0}], ['y', {d:0}]],
        expect: [['x', {i:['a', 'b', 'c']}], ['y', {i:'XX'}]]}) );

      it('picks the correct element of an embedded insert 2', () => compose({
        op1: ['x', {i:['a', 'b', 'c']}, 1, {i:'XX'}],
        op2: [['x', 3, {p:0}], ['y', {d:0}]], // should grab 'c'.
        expect: [['x', {i:['a', 'b']}, 1, {i:'XX'}], ['y', {i:'c'}]]}) );


      it('moves all children', () => compose({
        op1: ['x', {i:{}}, 'y', {i:[1,2,3]}],
        op2: [['x', {p:0}], ['z', {d:0}]],
        expect: ['z', {i:{}}, 'y', {i:[1,2,3]}]}) );

      it('removes all children', () => compose({
        op1: ['x', {i:{}}, 'y', {i:[1,2,3]}],
        op2: ['x', {r:true}],
        expect: null
      })
       );

      it('removes all children when removed at the destination', () => compose({
        op1: [['x', {p:0}], ['y', {d:0}, 0, {i:'hi'}]],
        op2: ['y', {r:true}],
        expect: ['x', {r:true}]}) );

      it('vs op2 insert', () => compose({ // Inserts aren't folded together.
        op1: [{i:{}}],
        op2: ['x', {i:'hi'}],
        expect: [{i:{}}, 'x', {i:'hi'}]}) );

      it('vs op2 string edit', () => compose({
        op1: [{i:'hi'}],
        op2: [{es:[2, ' there']}],
        expect: [{i:'hi', es:[2, ' there']}]}) );

      return it('vs op2 number edit', () => compose({
        op1: [{i:10}],
        op2: [{ena:20}],
        expect: [{i:10, ena:20}]}) );
  });

    describe('op1 edit', function() {
      it('removes the edit if the edited object is deleted', () => compose({
        op1: ['x', {es:['hi']}],
        op2: ['x', {r:true}],
        expect: ['x', {r:true}]}) );

      it('removes the edit in an embedded insert 1', () => compose({
        op1: ['x', {i:'', es:['hi']}],
        op2: ['x', {r:true}],
        expect: null
      })
       );

      it('removes the edit in an embedded insert 2', () => compose({
        op1: ['x', {i:['']}, 0, {es:['hi']}],
        op2: ['x', 0, {r:true}],
        expect: ['x', {i:[]}]}) );

      it('composes string edits', () => compose({
        op1: [{es:['hi']}],
        op2: [{es:[2, ' there']}],
        expect: [{es:['hi there']}]}) );

      it('composes number edits', () => compose({
        op1: [{ena:10}],
        op2: [{ena:-8}],
        expect: [{ena:2}]}) );

      it('transforms and composes edits', () => compose({
        op1: ['x', {es:['hi']}],
        op2: [['x', {p:0}], ['y', {d:0, es:[2, ' there']}]],
        expect: [['x', {p:0}], ['y', {d:0, es:['hi there']}]]}) );

      it('preserves inserts with edits', () => compose({
        op1: ['x', {i:'hi'}],
        op2: [['x', {p:0}], ['y', {d:0, es:[' there']}]],
        expect: ['y', {i:'hi', es:[' there']}]}) );

      it('allows a different edit in the same location', () => compose({
        op1: ['x', {es:['hi']}],
        op2: ['x', {r:true, i:'yo', es:[2, ' there']}],
        expect: ['x', {r:true, i:'yo', es:[2, ' there']}]}) );

      return it('throws if the type is missing', () => assert.throws(() => type.compose([{et:'missing', e:{}}], [{et:'missing', e:{}}])));
  });

    describe('op2 pick', () =>
      it('gets untransformed by op1 drops', () =>
        ({
          op1: [5, {i:'hi'}],
          op2: [6, {r:true}],
          expect: [5, {r:true, i:'hi'}]
        })
    )
  );

    describe('op1 insert containing a drop', () =>
      it('vs pick at insert', () => compose({
        op1: [['x', {p:0}], ['y', {i:{}}, 'x', {d:0}]],
        op2: [['y', {p:0}], ['z', {d:0}]],
        expect: [['x', {p:0}], ['z', {i:{}}, 'x', {d:0}]]}) )
  );

    describe('fuzzer tests', () =>
      it('complicated transform of indicies', () => compose({
        op1: [ 0, { p: 0 }, 'x', 2, { d: 0 } ],
        op2: [ 0, 'x', 0, { r: true } ],
        expect: [
          [0, {p:0}, 'x', 1, {d:0}],
          [1, 'x', 0, {r:true}]
        ]}) )
  );

    describe('setnull interaction', function() {
      // Currently failing.
      it('reorders items inside a setnull region', () => compose({
        op1: [{i:[]}, [0, {i:'a'}], [1, {i:'b'}]],
        op2: [[0, {p:0}], [1, {d:0}]],
        expect: [{i:[]}, [0, {i:'b'}], [1, {i:'a'}]]}) );

      it('lets a setnull child be moved', () => compose({
        op1: ['list', {i:[]}, 0, {i:'hi'}],
        op2: [['list', 0, {p:0}], ['z', {d:0}]],
        expect: [['list', {i:[]}], ['z', {i:'hi'}]]}) );

      return it('lets a setnull child get modified', () => compose({
        op1: [{i:[]}, 0, {i:['a']}],
        op2: [0, 0, {r:'a', i:'b'}],
        expect: [{i:[]}, 0, {i: []}, 0, {i: 'b'}]}) );
  });
        //expect: [{i:[]}, 0, {i:['b']}] # Maybe better??

    return describe('regression', function() {
      it('skips op2 drops when calculating op1 drop index simple', () => compose({
        op1: [[ 0, { p: 0 } ], [ 2, { d: 0 } ]],
        op2: [[ 0, { p: 0 } ], [ 1, { d: 0 } ]],
        expect: [ [ 0, { p: 1 } ], [ 1, { p: 0, d: 0 } ], [ 2, { d: 1 } ] ]}) );

      it('skips op2 drops when calculating op1 drop index complex', () => compose({
        op1: [[0, {p:0, d:1}], [1, {p:1}], [2, {d:0}]],
        op2: [[0, {p:0}], [1, {d:0}]],
        // expect: [[0, {p:1}], [1, {d:0, p:0}], [2, d:1]]
        expect: [[0, {p:1}], [1, {p:0, d:0}], [2, {d:1}]]}) );

      it('3', () => compose({
        op1: [ { i: [ null, [] ] }, 0, { i: '' } ],
        op2: [ 1, { p: 0 }, 0, { d: 0 } ],
        // ... it'd be way more consistent to drop the null separately rather than merging it??
        expect: [ { i: [ [] ] }, [ 0, { i: '' } ], [ 1, 0, { i: null } ] ]}) );

      return it('4', () => compose({ // This one triggered a bug in cursor!
        op1: [ 0,
          [ 0, [ 'a', { r: true } ], [ 'b', { d: 0 } ] ],
          [ 2, { p: 0 } ] ],
        op2: [ 0, 0, 'c', { i: 'd' } ],
        expect: [ 0,
          [ 0, [ 'a', { r: true } ], [ 'b', { d: 0 } ], [ 'c', { i: 'd' } ] ],
          [ 2, { p: 0 } ]
        ]}) );
  });
});

  // *** Old stuff
  describe('old compose', function() {
    it('gloms together unrelated edits', function() {
      compose({
        op1: [['a', {p:0}], ['b', {d:0}]],
        op2: [['x', {p:0}], ['y', {d:0}]],
        expect: [['a', {p:0}], ['b', {d:0}], ['x', {p:1}], ['y', {d:1}]]});

      return compose({
        op1: [2, {i:'hi'}],
        op2: [0, 'x', {r:true}],
        expect: [[0, 'x', {r:true}], [2, {i:"hi"}]]});
  });

    it('translates drops in objects', () => compose({
      op1: ['x', ['a', {p:0}], ['b', {d:0}]], // x.a -> x.b
      op2: [['x', {p:0}], ['y', {d:0}]], // x -> y
      expect: [['x', {p:0}, 'a', {p:1}], ['y', {d:0}, 'b', {d:1}]]}) ); // x.a -> y.b, x -> y

    it('untranslates picks in objects', () => compose({
      op1: [['x', {p:0}], ['y', {d:0}]], // x -> y
      op2: [['y', 'a', {p:0}], ['z', {d:0}]], // y.a -> z
      expect: [['x',{p:0},'a',{p:1}], ['y',{d:0}], ['z',{d:1}]]}) ); // x.a -> z, x -> y

    it('insert gets carried wholesale', () => compose({
      op1: ['x', {i:'hi there'}],
      op2: [['x', {p:0}], ['y', {d:0}]], // x -> y
      expect: ['y', {i:'hi there'}]}) );

    it('insert gets edited by the op', () => compose({
      op1: ['x', {i:{a:1, b:2, c:3}}],
      op2: [['x', 'a', {p:0}], ['y', {d:0}]],
      expect: [['x', {i:{b:2, c:3}}], ['y', {i:1}]]}) );

    return it('does not merge mutual inserts', () => compose({
      op1: [{i:{}}],
      op2: ['x', {i:"hi"}],
      expect: [{i:{}}, 'x', {i:'hi'}]}) );
});

    // TODO: List nonsense.

    // TODO: Edits.


// ****** Transform ******

  describe('transform', function() {
    describe('op1 pick', function() {
      it('vs delete', () => xf({
        op1: [['x', {p:0}], ['y', {d:0}]],
        op2: ['x', {r:true}],
        expect: null
      })
       );
      it('vs delete parent', () => xf({
        op1: [['x', 'a', {p:0}], ['y', {d:0}]],
        op2: ['x', {r:true}],
        expect: null
      })
       );
      it('vs delete parent 2', () => xf({
        op1: ['x', ['a', {p:0}], ['b', {d:0}]],
        op2: ['x', {r:true}],
        expect: null
      })
       );

      it('vs pick', () => xf({
        op1: [['x', {p:0}], ['z', {d:0}]],
        op2: [['x', {p:0}], ['y', {d:0}]],
        // Consider adding a conflict for this case.
        expectLeft: [['y', {p:0}], ['z', {d:0}]],
        expectRight: null
      })
       );
      it('vs pick parent', () => xf({
        op1: [['x', 'a', {p:0}], ['z', {d:0}]],
        op2: [['x', {p:0}], ['y', {d:0}]],
        expect: [['y', 'a', {p:0}], ['z', {d:0}]]}) );

      it('vs pick and pick child', () => xf({ // regression
        op1: [ // a -> xa, a.c -> xc
          ['a', {p:0}, 'c', {p:1}],
          ['xa', {d:0}],
          ['xc', {d:1}]
        ],
        op2: [['a', {p:0}], ['b', {d:0}]], // a -> b
        expectLeft: [
          ['b', {p:0}, 'c', {p:1}],
          ['xa', {d:0}],
          ['xc', {d:1}]
        ],
        expectRight: [
          ['b', 'c', {p:0}],
          ['xc', {d:0}]
        ]}) );

      it('vs edit', () => xf({
        op1: [['x', {p:0}], ['z', {d:0}]],
        op2: ['x', {es:['hi']}],
        expect: [['x', {p:0}], ['z', {d:0}]]}) );

      it('vs delete, drop', () => xf({
        op1: [['x', {p:0}], ['y', {d:0}]],
        op2: [['a', {p:0}], ['x', {r:0, d:0}]],
        expect: null
      })
       );

      it('vs delete, insert', () => xf({
        op1: [['x', {p:0}], ['y', {d:0}]],
        op2: ['x', {r:0, i:5}],
        expect: null
      })
       );

      it('vs pick, drop to self',
        () => xf({
          op1: [['x', {p:0}], ['y', {d:0}]],
          op2: [['x', {p:0}], ['y', {d:0}]],
          expect: null
        }) ,

        () => xf({
          op1: [['a', 1, {p:0}], ['y', {d:0}]],
          op2: [['a', 1, {p:0}], ['y', {d:0}]],
          expect: null
        })
       );

      it('vs pick, drop', () => xf({
        op1: [['x', {p:0}], ['z', {d:0}]], // x->z
        op2: [['a', {p:0}], ['x', {p:1, d:0}], ['y', {d:1}]], // a->x, x->y
        expectLeft: [['y', {p:0}], ['z', {d:0}]],
        expectRight: null
      })
       );

      it('vs pick, insert', () => xf({
        op1: [['x', {p:0}], ['z', {d:0}]],
        op2: [['x', {p:0, i:5}], ['y', {d:0}]],
        expectLeft: [['y', {p:0}], ['z', {d:0}]],
        expectRight: null
      })
       );

      return it('vs pick, edit', () =>
        ({
          op1: [['x', {p:0}], ['z', {d:0}]],
          op2: [['x', {es:['hi'], p:0}], ['y', {d:0}]],
          expectLeft: [['y', {p:0}], ['z', {d:0}]],
          expectRight: null
        })
      );
    });

    describe('op1 delete', function() {
      it('vs delete', () => xf({
        op1: ['x', {r:true}],
        op2: ['x', {r:true}],
        expect: null
      })
       );
      it('vs delete parent', () => xf({
        op1: ['x', 'a', {r:true}],
        op2: ['x', {r:true}],
        expect: null
      })
       );

      it('vs pick', () => xf({
        op1: ['x', {r:true}],
        op2: [['x', {p:0}], ['y', {d:0}]],
        expect: ['y', {r:true}]}) );
      it('vs pick parent', () => xf({
        op1: ['x', 'a', {r:true}],
        op2: [['x', {p:0}], ['y', {d:0}]],
        expect: ['y', 'a', {r:true}]}) );

      it('vs pick and drop', () => xf({
        op1: ['x', {r:true}],
        op2: [['a', {p:0}], ['x', {d:0, p:1}], ['z', {d:1}]],
        expect: ['z', {r:true}]}) );

      it('vs edit', () => xf({
        op1: ['x', {r:true}],
        op2: ['x', {es:['hi']}],
        conflict: { type: RM_UNEXPECTED_CONTENT
      },
        expect: ['x', {r:true}]}) );

      it('vs move and insert', () => xf({
        op1: [ 'a', 1, { r: true } ],
        op2: [
          [ 'a', { p: 0 } ],
          [ 'b', { d: 0 }, [ 0, { i: 5 } ], [ 1, { i: 5 } ] ]
        ],
        expect: ['b', 3, {r:true}]}) );

      return describe('vs pick child', function() {
        it('move in', () => xf({
          op1: ['x', {r:true}],
          op2: [['a', {p:0}], ['x', 'y', {d:0}]],
          conflict: { type: RM_UNEXPECTED_CONTENT
        },
          expect: ['x', {r:true}, 'y', {r:true}]}) ); // Also ok if its just x, r:true

        it('move across', () => xf({
          op1: ['x', {r:true}], // delete doc.x
          op2: ['x', ['y', {p:0}], ['z', {d:0}]],
          expect: ['x', {r:true}]}) );

        it('move out', () => xf({
          op1: ['x', {r:true}],
          op2: [['x', 'y', {p:0}], ['y', {d:0}]], // move doc.x.y -> doc.y
          expect: [['x', {r:true}], ['y', {r:true}]]}) ); // delete doc.x and doc.y

        it('multiple out', () => xf({
          op1: ['x', {r:true}],
          op2: [['x', 'y', {p:0}, 'z', {p:1}], ['y', {d:0}], ['z', {d:1}]],
          expect: [['x', {r:true}], ['y', {r:true}], ['z', {r:true}]]}) );

        it('chain out', () => xf({
          op1: ['x', {r:true}],
          op2: [['x', 'y', {p:0}], ['y', {p:1}], ['z', {d:0}, 'a', {d:1}]],
          conflict: {
            type: RM_UNEXPECTED_CONTENT,
            op2: [['y', {p:0}], ['z', 'a', {d:0}]]
          }, // cMv(['y'], ['z', 'a'])
          expect: [['x', {r:true}], ['z', {r:true}, 'a', {r:true}]]}) );

        return it('mess', () => xf({
          // yeesh
          op1: [['x', {r:true}, 'y', 'z', {p:0}], ['z', {d:0}]],
          op2: [['x', 'y', {p:0}], ['y', {d:0}]],
          expect: [['x', {r:true}], ['y', {r:true}, 'z', {p:0}], ['z', {d:0}]]}) );
    });
  });

    describe('op1 drop', function() {
      it('vs delete parent', () => xf({
        op1: [['x', {p:0}], ['y', 'a', {d:0}]],
        op2: ['y', {r:true}],
        conflict: { type: RM_UNEXPECTED_CONTENT
      },
        expect: ['x', {r:true}]}) );

      it('vs a cancelled parent', () => xf({
        // This is actually a really complicated case.
        op1: [['x', 'y', {p:0}], ['y', {p:1}], ['z', {d:0}, 'a', {d:1}]],
        op2: ['x', {r:true}],
        conflict: {
          type: RM_UNEXPECTED_CONTENT,
          op1: [['y', {p:0}], ['z', 'a', {d:0}]]
        }, // c1: cMv(['y'], ['z', 'a'])
        expect: ['y', {r:true}]}) );

      it('vs pick parent', () => xf({
        op1: [['x', {p:0}], ['y', 'a', {d:0}]],
        op2: [['y', {p:0}], ['z', {d:0}]],
        expect: [['x', {p:0}], ['z', 'a', {d:0}]]}) );

      it('vs drop', () => xf({
        op1: [['x', {p:0}], ['z', {d:0}]],
        op2: [['y', {p:0}], ['z', {d:0}]],
        conflict: { type: DROP_COLLISION
      },
        expectLeft: [['x', {p:0}], ['z', {r:true, d:0}]],
        expectRight: ['x', {r:true}]}) );

      it('vs drop (list)', () => xf({
        op1: [[0, {p:0}], [4, {d:0}]],
        op2: [[5, {d:0}], [10, {p:0}]],
        expectLeft: [[0, {p:0}], [4, {d:0}]],
        expectRight: [[0, {p:0}], [5, {d:0}]]}) );

      it('vs drop (chained)', () => xf({
        op1: [['a', {p:1}], ['x', {p:0}], ['z', {d:0}, 'a', {d:1}]],
        op2: [['y', {p:0}], ['z', {d:0}]],
        conflict: {
          type: DROP_COLLISION,
          op1: [['x', {p:0}], ['z', {d:0}]]
        }, //cMv(['x'], ['z'])
        expectLeft: [['a', {p:0}], ['x', {p:1}], ['z', {r:true, d:1}, 'a', {d:0}]],
        expectRight: [['a', {r:true}], ['x', {r:true}]]}) );

      it('vs insert', () => xf({
        op1: [['x', {p:0}], ['z', {d:0}]],
        op2: ['z', {i:5}],
        conflict: { type: DROP_COLLISION
      },
        expectLeft: [['x', {p:0}], ['z', {r:true, d:0}]],
        expectRight: ['x', {r:true}]}) );

      it('vs pick (a->b->c vs b->x)', () => xf({
        op1: [['a', {p:0}], ['b', {p:1, d:0}], ['c', {d:1}]],
        op2: [['b', {p:0}], ['x', {d:0}]],
        expectLeft: [['a', {p:0}], ['b', {d:0}], ['c', {d:1}], ['x', {p:1}]],
        expectRight: [['a', {p:0}], ['b', {d:0}]]}) );

      return describe.skip('vs move inside me', function() {
        // Note: This is *not* blackholeing! The edits are totally fine; we
        // just need one edit to win.
        // The current behaviour just nukes both.
        it('in objects', () => xf({
          op1: [['x', {p:0}], ['y', 'a', {d:0}]],
          op2: [['x', 'a', {d:0}], ['y', {p:0}]],
          expectLeft: [['x', {p:0}, 'a', {p:1}], ['y', {d:1}, 'x', {d:0}]],
          expectRight: null
        })
         );

        it('in lists', () => xf({
          op1: [0, {p:0}, 'x', {d:0}],
          op2: [[0, 'y', {d:0}], [1, {p:0}]],
          expectLeft: [0, {p:0, d:1}, ['x', {d:0}], ['y', {p:1}]],
          expectRight: null
        })
         );

        return it('multiple', () => xf({
          // a->x.a, b->x.b
          op1: [['a', {p:0}], ['b', {p:1}], ['x', 'a', {d:0}, 'b', {d:1}]],
          op2: [['a', 'x', {d:0}], ['x', {p:0}]], // x->a.x
          expectLeft: [['a', {p:0}, 'x', {p:1}], ['b', {p:2}],
            ['x', {d:1}, ['a', {d:0}], ['b', {d:2}]]],
          expectRight: null
        })
         );
      });
    });

    describe('op1 insert', function() {
      it('vs delete parent', () => xf({
        op1: ['y', 'a', {i:5}],
        op2: ['y', {r:true}],
        conflict: { type: RM_UNEXPECTED_CONTENT
      },
        expect: null
      })
       );

      it('vs pick parent', () => xf({
        op1: ['y', 'a', {i:5}],
        op2: [['y', {p:0}], ['z', {d:0}]],
        expect: ['z', 'a', {i:5}]}) );

      it('vs drop', () => xf({
        op1: ['z', {i:5}],
        op2: [['y', {p:0}], ['z', {d:0}]],
        conflict: { type: DROP_COLLISION
      },
        expectLeft: ['z', {r:true, i:5}],
        expectRight: null
      })
       );

      it('vs insert', () => xf({
        op1: ['z', {i:5}],
        op2: ['z', {i:10}],
        conflict: { type: DROP_COLLISION
      },
        expectLeft: ['z', {r:true, i:5}],
        expectRight: null
      })
       );

      it('vs insert at list position', () => xf({
        op1: [5, {i:'hi'}],
        op2: [5, {i:'there'}],
        expectLeft: [5, {i:'hi'}],
        expectRight: [6, {i:'hi'}]}) );

      it('vs identical insert', () => xf({
        op1: ['z', {i:5}],
        op2: ['z', {i:5}],
        expect: null
      })
       );

      // This is the new setNull for setting up schemas
      it('vs embedded inserts', function() {
        xf({
          op1: ['x', {i:{}}],
          op2: ['x', {i:{}}, 'y', {i:5}],
          expect: null
        });

        xf({
          op1: ['x', {i:{}}, 'y', {i:5}],
          op2: ['x', {i:{}}],
          expect: ['x', 'y', {i:5}]});

        xf({
          op1: ['x', {i:{}}, 'y', {i:5}],
          op2: ['x', {i:{}}, 'y', {i:5}],
          expect: null
        });

        return xf({
          op1: ['x', {i:{}}, 'y', {i:5}],
          op2: ['x', {i:{}}, 'y', {i:6}],
          conflict: {
            type: DROP_COLLISION,
            op1: ['x', 'y', {i:5}],
            op2: ['x', 'y', {i:6}]
          },
          expectLeft: ['x', 'y', {r:true, i:5}],
          expectRight: null
        });
      });

      return it('with embedded edits', () => xf({
        op1: [{i:'', es:['aaa']}],
        op2: [{i:'', es:['bbb']}],
        expectLeft: [{es:['aaa']}],
        expectRight: [{es:[3, 'aaa']}]}) );
  });

    describe('op1 edit', function() {
      it('vs delete', () => xf({
        op1: ['x', {es:['hi']}],
        op2: ['x', {r:true}],
        conflict: { type: RM_UNEXPECTED_CONTENT
      },
        expect: null
      })
       );

      it('vs delete parent', () => xf({
        op1: ['x', 'y', {es:['hi']}],
        op2: ['x', {r:true}],
        conflict: { type: RM_UNEXPECTED_CONTENT
      },
        expect: null
      })
       );

      it('vs pick', () => xf({
        op1: ['x', {es:['hi']}],
        op2: [['x', {p:0}], ['y', {d:0}]],
        expect: ['y', {es:['hi']}]}) );

      it('vs edit string', () => xf({
        op1: ['x', {es:['ab']}],
        op2: ['x', {es:['cd']}],
        expectLeft: ['x', {es:['ab']}],
        expectRight: ['x', {es:[2, 'ab']}]}) );

      it('vs edit number', () => xf({
        op1: [{ena:5}],
        op2: [{ena:100}],
        expect: [{ena:5}]}) );

      it('throws if edit types arent compatible', () => assert.throws(() => type.transform([{es:[]}], [{ena:5}], 'left')));

      it('vs move and edit', () => xf({
        op1: ['x', {es:[1, 'ab']}],
        op2: [['x', {p:0}], ['y', {d:0, es:[{d:1}, 'cd']}]],
        expectLeft: ['y', {es:['ab']}],
        expectRight: ['y', {es:[2, 'ab']}]}) );

      return it('throws if the type is missing', () => assert.throws(() => type.transform([{et:'missing', e:{}}], [{et:'missing', e:{}}], 'left')));
    });

    describe('op2 cancel move', function() {
      it('and insert', () => xf({
        op1: ['x', {r:true}],
        op2: [['x', 'a', {p:0}], ['y', {d:0}, 'b', {i:5}]],
        conflict: {
          type: RM_UNEXPECTED_CONTENT,
          op2: ['y', 'b', {i:5}]
        },
        expect: [['x', {r:true}], ['y', {r:true}, 'b', {r:true}]]}) );

      return it('and another move (rm x vs x.a -> y, q -> y.b)', () => xf({
        op1: ['x', {r:true}],
        op2: [['q', {p:1}], ['x', 'a', {p:0}], ['y', {d:0}, 'b', {d:1}]],
        conflict: {
          type: RM_UNEXPECTED_CONTENT,
          op2: [['q', {p:0}], ['y', 'b', {d:0}]]
        },
        expect: [['x', {r:true}], ['y', {r:true}, 'b', {r:true}]]}) );
  });

    describe('op2 list move an op1 drop', function() {
      it('vs op1 remove', () => xf({
        op1: [[0, {r:true}, 'a', {i:'hi'}], [5, {r:true}]],
        op2: [[1, {p:0}], [4, {d:0}]],
        expect: [[0, {r:true}], [3, 'a', {i:'hi'}], [5, {r:true}]]}) );

      it('vs op1 remove 2', () => xf({
        op1: [[0, {r:true}, 'a', {i:'hi'}], [1, {r:true}], [2, {r:true}]],
        op2: [[3, {p:0}], [4, {d:0}]],
        expect: [[0, {r:true}], [1, {r:true}, 'a', {i:'hi'}], [2, {r:true}]]}) );

      it('vs op1 insert before', () => xf({
        op1: [[0, {i:'a'}], [1, {i:'b'}], [2, 'a', {i:'hi'}]],
        op2: [[0, {p:0}], [1, {d:0}]],
        expect: [[0, {i:'a'}], [1, {i:'b'}], [3, 'a', {i:'hi'}]]}) );


      return it('vs op1 insert before and replace', () => xf({
        op1: [[0, {i:'xx'}, 'a', {r:true}], [1, 'a', {i:'hi'}]],
        op2: [[0, {p:0}], [3, {d:0}]],
        expect: [[0, {i:'xx'}], [3, 'a', {r:true}], [4, 'a', {i:'hi'}]]}) );
  });


    return describe('list', () =>
      describe('drop', function() {
        it('transforms by p1 drops', () => xf({
          op1: [[5, {i:5}], [10, {i:10}]],
          op2: [9, {i:9}],
          expectLeft: [[5, {i:5}], [10, {i:10}]],
          expectRight: [[5, {i:5}], [11, {i:10}]]}) );

        it('transforms by p1 picks');
        it('transforms by p2 picks');
        return it('transforms by p2 drops');
      })
    );
  });

  describe('conflicts', function() {
    describe('drop into remove / rm unexpected', function() {
      // xfConflict does both xf(op1, op2, left) and xf(op2, op1, right), and
      // uses invConflict. So this also tests RM_UNEXPECTED_CONTENT with each
      // test case.
      it('errors if you insert', () => xf({
        op1: ['a', 'b', {i:5}],
        op2: ['a', {r:true}],
        conflict: { type: RM_UNEXPECTED_CONTENT
      },
        expect: null
      })
       );

      it('errors if you drop', () => xf({
        op1: [['a', {p:0}], ['x', 'b', {d:0}]],
        op2: ['x', {r:true}],
        conflict: { type: RM_UNEXPECTED_CONTENT
      },
        expect: ['a', {r:true}]}) );

      it('errors if you rm then insert in a child', () => xf({
        op1: ['a', 'b', {r:true, i:5}],
        op2: ['a', {r:true}],
        conflict: {
          type: RM_UNEXPECTED_CONTENT,
          op1: ['a', 'b', {i:5}]
        },
        expect: null
      })
       );

      it('errors if the object is replaced', () => xf({
        op1: ['a', 'b', {i:5}],
        op2: ['a', {r:true, i:10}],
        conflict: {
          type: RM_UNEXPECTED_CONTENT,
          op2: ['a', {r:true}]
        },
        expect: null
      })
       );

      it('handles a delete of the source parent by op2', () => xf({
        op1: [['a', {p:0}], ['b', 'b', {d:0}]],
        op2: [['a', {p:0}], ['b', {r:true}, 'c', {d:0}]],
        conflictLeft: {
          type: RM_UNEXPECTED_CONTENT,
          op2: ['b', {r:true}]
        },
        expectLeft: ['b', 'c', {r:true}],
        expectRight: null
      })
       );

      return it.skip('returns symmetric errors when both ops delete the other', () => xf({
        // The problem here is that there's two conflicts we want to return.
        // Which one should be returned first? It'd be nice for the order of
        // conflict returning to be symmetric - that is, if we know multiple
        // conflicts happen, order them based on left/right. But I haven't done
        // that, so we get different conflicts out of this in a first pass.
        op1: [ [ 'x', { r: true } ], [ 'y', 'a', { i: {} } ] ],
        op2: [ [ 'x', 'a', { i: {} } ], [ 'y', { r: true } ] ],
        conflict: { type: RM_UNEXPECTED_CONTENT
      },
        expect: ['x', {r:true}]}) );
  });

    describe('overlapping drop', function() {
      it('errors if two ops insert different content into the same place in an object', () => xf({
        op1: ['x', {i:'hi'}],
        op2: ['x', {i:'yo'}],
        conflict: { type: DROP_COLLISION
      },
        expectLeft: ['x', {r:true, i:'hi'}],
        expectRight: null
      })
       );

      it('does not conflict if inserts are identical', () => xf({
        op1: ['x', {i:'hi'}],
        op2: ['x', {i:'hi'}],
        expectLeft: null,
        expectRight: null
      })
       );

      it('does not conflict if the two operations make identical moves', () => xf({
        op1: [['a', {p:0}], ['x', {d:0}]],
        op2: [['a', {p:0}], ['x', {d:0}]],
        expect: null
      })
       ); // ??? Also ok for left: ['x', p:0, d:0]

      it('does not conflict if inserts are into a list', () => xf({
        op1: [1, {i:'hi'}],
        op2: [1, {i:'yo'}],
        expectLeft: [1, {i:'hi'}],
        expectRight: [2, {i:'hi'}]}) );

      it('errors if the inserts are at the root', () => xf({
        op1: [{i:1}],
        op2: [{i:2}],
        conflict: { type: DROP_COLLISION
      },
        expectLeft: [{r:true, i:1}],
        expectRight: null
      })
       );

      it('errors with insert vs drop', () => xf({
        op1: ['x', {i:'hi'}],
        op2: [['a', {p:0}], ['x', {d:0}]],
        // ????
        conflict: { type: DROP_COLLISION
      },
        expectLeft: ['x', {r:true, i:'hi'}],
        expectRight: null
      })
       );

      it('errors with drop vs insert', () => xf({
        op1: [['a', {p:0}], ['x', {d:0}]],
        op2: ['x', {i:'hi'}],
        conflict: { type: DROP_COLLISION
      },
        expectLeft: [['a', {p:0}], ['x', {r:true, d:0}]],
        expectRight: ['a', {r:true}]}) );

      it('errors with drop vs drop', () => xf({
        op1: [['a', {p:0}], ['x', {d:0}]],
        op2: [['b', {p:0}], ['x', {d:0}]],
        conflict: { type: DROP_COLLISION
      },
        expectLeft: [['a', {p:0}], ['x', {r:true, d:0}]],
        expectRight: ['a', {r:true}]}) );

      return it('errors if the two sides insert in the vacuum', () => xf({
        op1: [['a', {p:0}], ['b', {d:0}], ['c', {i:5}]],
        op2: [['a', {p:0}], ['b', {i:6}], ['c', {d:0}]],
        conflictLeft: {
          type: DROP_COLLISION,
          op1: [['a', {p:0}], ['b', {d:0}]],
          op2: ['b', {i:6}]
        },
        expectLeft: [['b', {r:true, d:0}], ['c', {p:0, i:5}]],
        conflictRight: {
          type: DROP_COLLISION,
          op1: ['c', {i:5}],
          op2: [['a', {p:0}], ['c', {d:0}]]
        },
        expectRight: null
      })
       );
    });


    describe('discarded edit', function() {
      it('edit removed directly', () => xf({
        op1: ['a', {es:[]}],
        op2: ['a', {r:true}],
        conflict: { type: RM_UNEXPECTED_CONTENT
      },
        expect: null
      })
       );

      return it('edit inside new content throws RM_UNEXPECTED_CONTENT', () => xf({
        op1: ['a', 'b', {i: 'hi', es:[]}],
        op2: ['a', {r:true}],
        conflict: {
          type: RM_UNEXPECTED_CONTENT,
          op1: ['a', 'b', {i:'hi'}]
        },
        expect: null
      })
       );
    });

    return describe('blackhole', function() {
      it('detects and errors', () => xf({
        op1: [['x', {p:0}], ['y', 'a', {d:0}]],
        op2: [['x', 'a', {d:0}], ['y', {p:0}]],
        conflict: { type: BLACKHOLE
      },
        expect: ['x', {r:true}, 'a', {r:true}]}) ); // Also equivalent: ['x', r:true]

      it('blackhole logic does not apply when op2 removes parent', () => xf({
        // TODO: Although you wouldn't know it, since this result is very similar.
        op1: [['x', {p:0}], ['y', 'xx', 'a', {d:0}]],
        op2: [['x', 'a', {d:0}], ['y', {p:0}, 'xx', {r:true}]],
        conflict: {
          type: RM_UNEXPECTED_CONTENT,
          op2: ['y', 'xx', {r:true}]
        },
        expect: ['x', {r:true}, 'a', {r:true}]}) ); // Also ok: ['x', r:true]

      it('blackhole logic still applies when op2 inserts', () => xf({
        op1: [['x', {p:0}], ['y', 'a', {i:{}}, 'b', {d:0}]],
        op2: [['x', 'a', {i:{}}, 'b', {d:0}], ['y', {p:0}]],
        conflict: {
          type: BLACKHOLE,
          op1: [['x', {p:0}], ['y', 'a', 'b', {d:0}]],
          op2: [['x', 'a', 'b', {d:0}], ['y', {p:0}]]
        },
        expect: ['x', {r:true}, 'a', {r:true}, 'b', {r:true}]}) );

      it('blackholes items in lists correctly', () => xf({
        op1: [1, {p:0}, 'a', {d:0}],
        op2: [[1, 'b', {d:0}], [2, {p:0}]],
        conflict: { type: BLACKHOLE
      },
        expect: [1, {r:true}, 'b', {r:true}]}) );

      it('blackholes items despite scrambled pick and drop slots', () => xf({
        op1: [ [ 'a', { p: 1, d: 1 } ], [ 'x', { p: 0 } ], [ 'y', 'a', { d: 0 } ] ],
        op2: [ [ 'x', 'a', { d: 0 } ], [ 'y', { p: 0 } ] ],
        conflict: {
          type: BLACKHOLE,
          op1: [ [ 'x', { p: 0 } ], [ 'y', 'a', { d: 0 } ] ]
        },
        expect: [['a', {p:0, d:0}], ['x', {r:true}, 'a', {r:true}]]}) );

      it('handles chained blackholes', () => xf({
        op1: [ [ 'a', { p: 0 } ], // a->b.b, c->d.d
          [ 'b', 'b', { d: 0 } ],
          [ 'c', { p: 1 } ],
          [ 'd', 'd', { d: 1 } ]
        ],
        op2: [ [ 'a', 'a', { d: 1 } ], // b->c.c, d->a.a
          [ 'b', { p: 0 } ],
          [ 'c', 'c', { d: 0 } ],
          [ 'd', { p: 1 } ]
        ],
        conflict: { type: BLACKHOLE
      },
          // c1: cMv(['a'], ['b', 'b'])
          // c2: cMv(['b'], ['c', 'c'])
        expect: [['a', {r:true}, 'a', {r:true}], ['c', {r:true}, 'c', {r:true}]]}) );

      return it('creates conflict return values with valid slot ids', () => xf({
        op1: [['a', {p:0}], ['b', {d:0}], ['x', {p:1}], ['y', 'a', {d:1}]],
        op2: [['x', 'a', {d:0}], ['y', {p:0}]],
        conflict: {
          type: BLACKHOLE,
          op1: [['x', {p:0}], ['y', 'a', {d:0}]]
        },
        expect: [['a', {p:0}], ['b', {d:0}], ['x', {r:true}, 'a', {r:true}]]}) );
  });
});


  describe('transform-old', function() {
    it('foo', () =>
      xf({
        op1: [
          ['x', ['a', {p:0}], ['b', {d:0}]],
          ['y', ['a', {p:1}], ['b', {d:1}]]
        ],
        op2: ['x', {r:true}],
        expect: ['y', ['a', {p:0}], ['b', {d:0}]]})
  );

    // it 'hard', ->
    //   op1: ['x', [1, r:true], [2, r:true, es:['hi']]] # Edit at index 4 originally.
    //   # move the edited string to .y[4] which
    //   op2: [['x', 4, p:0], ['y', [2, r:true], [4, d:0]]]
    //   expect:

    describe('object edits', () =>
      it('can reparent with some extra junk', () => xf({
        op1: [['x', {p:0}], ['y', {d:0}]],
        op2: [
          ['_a', {d:1}],
          ['_x', {d:0}],
          ['x', {p:0}, 'a', {p:1}]
        ],
        expectLeft: [['_x', {p:0}], ['y', {d:0}]],
        expectRight: null
      })
       )
    ); // the object was moved fair and square.

    describe('deletes', function() {

      it.skip('delete parent of a move', () => xf({
        // The current logic of transform actually just burns everything (in a
        // consistant way of course). I'm not sure if this is better or worse -
        // basically we'd be saying that if a move could end up in one of two places,
        // put it in the place where it won't be killed forever. But that introduces new
        // complexity, so I'm going to skip this for now.

        // x.a -> a, delete x
        op1: [['x', {r:true}, 'a', {p:0}], ['z', {d:0}]],
        // x.a -> x.b.
        op2: ['x', ['a', {p:0}], ['b', {d:0}]],
        expect: [['x', {r:true}, 'b', {p:0}], ['z', {d:0}]]}) ); // TODO: It would be better to do this in both cases.
        //expectRight: ['x', r:true]

      return it('awful delete nonsense', function() {
        xf({
          op1: [['x', {r:true}], ['y', {i:'hi'}]], // delete doc.x, insert doc.y
          op2: [['x', 'a', {p:0}], ['y', {d:0}]], // move doc.x.a -> doc.y
          expect: [['x', {r:true}], ['y', {r:true, i:'hi'}]]}); // del doc.x and doc.y, insert doc.y

        xf({
          op1: [['x', 'a', {p:0}], ['y', {d:0}]], // x.a -> y
          op2: [['x', {r:true}], ['y', {i:'hi'}]], // delete x, ins y
          expect: null
        });

        return xf({
          op1: [10, {r:true}],
          op2: [[5, {d:0}], [10, 1, {p:0}]],
          expect: [[5, {r:true}], [11, {r:true}]]});
    });
  });
        // And how do those indexes interact with pick / drop operations??


    describe('swap', function() {
      const swap = [
        ['a', {p:0}, 'b', {p:1}],
        ['b', {d:1}, 'a', {d:0}]
      ];

      it('noop vs swap', () => xf({
        op1: null,
        op2: swap,
        expect: null
      })
       );

      return it('can swap two edits', () => xf({
        op1: ['a', {es:['a edit']}, 'b', {es:['b edit']}],
        op2: swap,
        expect: ['b', {es:['b edit']}, 'a', {es:['a edit']}]}) );
  });

    describe('lists', function() {
      it('can rewrite simple list indexes', function() {
        xf({
          op1: [10, {es:['edit']}],
          op2: [0, {i:'oh hi'}],
          expect: [11, {es:['edit']}]});

        xf({
          op1: [10, {r:true}],
          op2: [0, {i:'oh hi'}],
          expect: [11, {r:true}]});

        return xf({
          op1: [10, {i:{}}],
          op2: [0, {i:'oh hi'}],
          expect: [11, {i:{}}]});
    });

      it('can change the root from an object to a list', () => xf({
        op1: ['a', {es:['hi']}],
        op2: [{i:[], r:true}, [0, {d:0}], ['a', {p:0}]],
        expect: [0, {es:['hi']}]}) );

      it('can handle adjacent drops', () => xf({
        op1: [[11, {i:1}], [12, {i:2}], [13, {i:3}]],
        op2: [0, {r:true}],
        expect: [[10, {i:1}], [11, {i:2}], [12, {i:3}]]}) );

      it('fixes drop indexes correctly 1', () => xf({
        op1: [[0, {r:true}], [1, {i:'hi'}]],
        op2: [1, {r:true}],
        expect: [0, {r:true, i:'hi'}]}) );

      it('list drop vs delete uses the correct result index', function() {
        xf({
          op1: [2, {i:'hi'}],
          op2: [2, {r:true}],
          expect: [2, {i:'hi'}]});

        return xf({
          op1: [3, {i:'hi'}],
          op2: [2, {r:true}],
          expect: [2, {i:'hi'}]});
    });

      it('list drop vs drop uses the correct result index', () => xf({
        op1: [2, {i:'hi'}],
        op2: [2, {i:'other'}],
        expectLeft: [2, {i:'hi'}],
        expectRight: [3, {i:'hi'}]}) );

      it('list drop vs delete and drop', function() {
        xf({
          op1: [2, {i:'hi'}],
          op2: [2, {r:true, i:'other'}],
          expectLeft: [2, {i:'hi'}],
          expectRight: [3, {i:'hi'}]});

        xf({
          op1: [3, {i:'hi'}],
          op2: [[2, {r:true}], [3, {i:'other'}]],
          expect: [2, {i:'hi'}]});

        return xf({
          op1: [4, {i:'hi'}],
          op2: [[2, {r:true}], [3, {i:'other'}]],
          expectLeft: [3, {i:'hi'}],
          expectRight: [4, {i:'hi'}]});
    });

      it('list delete vs drop', function() {
        xf({
          op1: [1, {r:true}],
          op2: [2, {i:'hi'}],
          expect: [1, {r:true}]});

        xf({
          op1: [2, {r:true}],
          op2: [2, {i:'hi'}],
          expect: [3, {r:true}]});

        return xf({
          op1: [3, {r:true}],
          op2: [2, {i:'hi'}],
          expect: [4, {r:true}]});
    });

      it('list delete vs delete', () =>
        xf({
          op1: [1, {r:true}],
          op2: [1, {r:true}],
          expect: null
        })
      ); // It was already deleted.

      it('fixes drop indexes correctly 2', () => xf({
        op1: [[0, {r:true}], [1, {i:'hi'}]],
        op2: [2, {r:true}], // Shouldn't affect the op.
        expect: [[0, {r:true}], [1, {i:'hi'}]]}) );

      it('insert vs delete parent', () => xf({
        op1: [2, 'x', {i:'hi'}],
        op2: [2, {r:true}],
        conflict: { type: RM_UNEXPECTED_CONTENT
      },
        expect: null
      })
       );

      it('transforms against inserts in my own list', () =>
        xf({ //[0,1,2,3] -> [a,0,b,1,2,3...]
          op1: [[0, {i:'a'}], [2, {i:'b'}]],
          op2: [1, {r:true}],
          expect: [[0, {i:'a'}], [2, {i:'b'}]]})
    );

      it('vs cancelled op2 drop', () => xf({
        doc: {x:{a:'x.a'}, y:['a','b','c']},
        op1: [['x', {r:true}], ['y', 3, {i:5}]],
        op2: [['x', 'a', {p:0}], ['y', 2, {d:0}]],
        expect: [['x', {r:true}], ['y', [2, {r:true}], [3, {i:5}]]]}) );

      it('vs cancelled op1 drop', () => xf({
        op1: [['x', {p:0}], ['y', [3, {d:0}], [4, {i:5}]]],
        op2: ['x', {r:true}],
        expect: ['y', 3, {i:5}]}) );

      it('vs cancelled op1 pick', () => xf({
        doc: Array.from('abcdefg'),
        op1: [[1, {p:0}], [4, {r:true, i:4}], [6, {d:0}]],
        op2: [1, {r:true}],
        expect: [[3, {r:true}], [4, {i:4}]]}) );

      it('xxxxx 1', () => diamond({ // TODO Regression.
        doc: Array.from('abcdef'),
        op1: [[1, {p:0, i:'AAA'}], [3, {i:'BBB'}], [5, {d:0}]],
        op2: [1, {r:true}]}) );

      return it('xxxxx 2', () => diamond({
        doc: Array.from('abcdef'),
        op1: [[1, {p:0, i:'AAA'}], [3, {d:0}], [5, {i:'CCC'}]],
        op2: [1, {r:true}]}) );
  });


    return describe('edit', function() {
      it('transforms edits by one another', () => xf({
        op1: [1, {es:[2, 'hi']}],
        op2: [1, {es:['yo']}],
        expect: [1, {es:[4, 'hi']}]}) );

      it('copies in ops otherwise', () => xf({
        op1: ['x', {e:{position:2, text:'wai'}, et:'simple'}],
        op2: ['y', {r:true}],
        expect: ['x', {e:{position:2, text:'wai'}, et:'simple'}]}) );

      it('allows edits at the root', () => xf({
        op1: [{e:{position:2, text:'wai'}, et:'simple'}],
        op2: [{e:{position:0, text:'omg'}, et:'simple'}],
        expect: [{e:{position:5, text:'wai'}, et:'simple'}]}) );

      it('applies edits in the right order', () => xf({
        // Edits happen *after* the drop phase.
        op1: [1, {es:[2, 'hi']}],
        op2: [[1, {i:{}}], [2, {es:['yo']}]],
        expect: [2, {es:[4, 'hi']}]}) );

      return it('an edit on a deleted object goes away', () => xf({
        op1: [1, {es:[2, 'hi']}],
        op2: [1, {r:"yo"}],
        conflict: {
          type: RM_UNEXPECTED_CONTENT,
          op2: [1, {r:true}]
        }, // .... It'd be better if this copied the remove.
        expect: null
      })
       );
    });
  });

      // TODO Numbers


// ***** Test cases found by the fuzzer which have caused issues
  return describe('fuzzer tests', function() {
    it('asdf', () => apply({
      doc: { the: '', Twas: 'the' },
      op: [ 'the', { es: [] } ],
      expect: { the: '', Twas: 'the' }}) );

    it('does not duplicate list items from edits', () => apply({
      doc: ['eyes'],
      op: [ 0, { es: [] } ],
      expect: ['eyes']}) );

    it('will edit the root document', () => apply({
      doc: '',
      op: [{es:[]}],
      expect: ''
    })
     );

    // ------ These have nothing to do with apply. TODO: Move them out of this grouping.

    it('diamond', () =>
      // TODO: Do this for all combinations.
      diamond({
        doc: Array.from('abcde'),
        op1: [ [ 0, { p: 0 } ], [ 1, { d: 0 } ] ],
        op2: [ [ 0, { p: 0 } ], [ 4, { d: 0 } ] ]})
  );

    it('shuffles lists correctly', () => xf({
      op1: [ [ 0, { p: 0 } ], [ 1, { d: 0 } ] ],
      op2: [ [ 0, { p: 0 } ], [ 10, { d: 0 } ] ],
      expectLeft: [ [ 1, { d: 0 } ], [ 10, { p: 0 } ] ],
      expectRight: null
    })
     );

    it('inserts before edits', function() {
      xf({
        op1: [0, 'x', {i:5}],
        op2: [0, {i:35}],
        expect: [1, 'x', {i:5}]});

      return xf({
        op1: [0, {es:[]}],
        op2: [0, {i:35}],
        expect: [1, {es:[]}]});
  });

    it('duplicates become noops in a list',
      () => xf({
        op1: [0,{"p":0,"d":0}],
        op2: [0,{"p":0,"d":0}],
        expectLeft: [0,{"p":0,"d":0}], // This is a bit weird.
        expectRight: null
      }) ,

      () => xf({
        op1: [0, {r:true, i:'a'}],
        op2: [0, {i:'b'}],
        expectLeft: [[0, {i:'a'}], [1, {r:true}]],
        expectRight: [1, {r:true, i:'a'}]}) ,

      () => xf({
        op1: [0, {r:true, i:5}],
        op2: [0, {r:true}],
        expect: [0, {i:5}]}) );

    it('p1 pick descends correctly', function() {
      xf({
        op1: [2, {r:true}, 1, {es:['hi']}],
        op2: [3, 1, {r:true}],
        conflict: {
          type: RM_UNEXPECTED_CONTENT,
          op1: [2, 1, {es:['hi']}]
        },
        expect: [2, {r:true}]});

      return xf({
        op1: [[2, {r:true}, 1, {es:['hi']}], [3, 1, {r:true}]],
        op2: [3, 2, {r:true}],
        conflict: {
          type: RM_UNEXPECTED_CONTENT,
          op1: [2, 1, {es:['hi']}]
        },
        expect: [[2, {r:true}], [3, 1, {r:true}]]});
  });

    it('transforms picks correctly', () => xf({
      op1: [1, 1, {r:true}],
      op2: [0, {p:0, d:0}],
      expect: [1, 1, {r:true}]}) );

    it('pick & drop vs insert after the picked item', () => xf({
      op1: [0, {p:0,d:0}], // Remove / insert works the same.
      op2: [1, {i:"hi"}],
      expectLeft: [0, {p:0,d:0}],
      expectRight: [[0, {p:0}], [1, {d:0}]]}) );

    it('pick same item vs shuffle list', () => xf({
      op1: [1, ['x', {p:0}], ['y', {d:0}]],
      op2: [1, {d:0}, 'x', {p:0}],
      expectLeft: [1, {p:0}, 'y', {d:0}],
      expectRight: null
    })
     );

    it('remove the same item in a list', () => xf({
      op1: [ 0, { r: true } ],
      op2: [ 0, { r: true } ],
      expect: null
    })
     );

    it('rm vs hold item', () => xf({
      op1: [ 0, { r: true } ],
      op2: [ 0, { p: 0, d: 0 } ],
      expect: [ 0, { r: true } ]}) );

    it('moves child elements correctly', () => xf({
      doc: ['a', [0,10,20], 'c'],
      op1: [ 1, 0, { p: 0, d: 0 } ],
      op2: [ [ 1, { d: 0 } ], [ 2, { p: 0 } ] ],
      expect: [ 2, 0, { d:0, p:0 } ]}) );

    it('moves list indexes', () => xf({
      doc: [[], 'b', 'c'],
      op1: [ [ 0, 'hi', { d: 0 } ], [ 1, { p: 0 } ] ],
      op2: [ [ 0, { p: 0 } ], [ 20, { d: 0 } ] ],
      expect: [[0, {p:0}], [19, 'hi', {d:0}]]}) );

    it('insert empty string vs insert null', () => xf({
      doc: undefined,
      op1: [{i:'hi'}],
      op2: [{i:null}],
      conflict: { type: DROP_COLLISION
    },
      expectLeft: [{r:true, i:'hi'}],
      expectRight: null
    })
     );

    it('move vs emplace', () => xf({
      doc: ['a', 'b'],
      op1: [[0, {p:0}], [1, {d:0}]],
      op2: [1, {p:0, d:0}],
      expectLeft: [0, {p:0, d:0}],
      expectRight: [[0, {p:0}], [1, {d:0}]]}) );

    it('rm chases a subdocument that was moved out', () => xf({
      doc: [ [ 'aaa' ] ],
      op1: [ 0, { r: true } ],
      op2: [ 0, { d: 0 }, 0, { p: 0 } ], // Valid because lists.
      expect: [[0, {r:true}], [1, {r:true}]]}) );

    it('colliding drops', () => xf({
      doc: [ 'a', 'b', {} ],
      op1: [[0, {p:0}], [1, 'x', {d:0}]], // -> ['b', x:'a']
      op2: [1, {p:0}, 'x', {d:0}], // -> ['a', x:'b']
      conflict: { type: DROP_COLLISION
    },
      expectLeft: [[0, {p:0}, 'x', {d:0}], [1, 'x', {r:true}]],
      expectRight: [0, {r:true}]}) );

    it('transform crash', () => xf({
      op1: [ [ 'the', { r: true, d: 0 } ], [ 'whiffling', { p: 0 } ] ],
      op2: [ 'the', { p: 0, d: 0 } ],
      expect: [ [ 'the', { d: 0, r: true } ], [ 'whiffling', { p: 0 } ] ]}) );

    it('transforms drops when the parent is moved by a remove', () => xf({
      op1: [['a', {p:0}], ['b', {d:0}, 1, {i:2}]],
      op2: ['a', 0, {r:1}],
      expect: [['a', {p:0}], ['b', {d:0}, 0, {i:2}]]}) );

    it('transforms drops when the parent is moved by a drop', () => xf({
      op1: [['a', {p:0}], ['b', {d:0}, 1, {i:2}]],
      op2: ['a', 0, {i:1}],
      expect: [['a', {p:0}], ['b', {d:0}, 2, {i:2}]]}) );

    it('transforms conflicting drops obfuscated by a move', () => xf({
      op1: [['a', {p:0}], ['b', {d:0}, 1, {i:2}]],
      op2: ['a', 1, {i:1}],
      expectLeft: [['a', {p:0}], ['b', {d:0}, 1, {i:2}]],
      expectRight: [['a', {p:0}], ['b', {d:0}, 2, {i:2}]]}) );

    it('transforms edits when the parent is moved', () => xf({
      op1: [ [ 'x', { p: 0 } ], [ 'y', { d: 0, es: [ 1, 'xxx' ] } ] ],
      op2: [ 'x', { es: [ {d: 1}, 'Z' ] } ],
      expectLeft: [ [ 'x', { p: 0 } ], [ 'y', { d: 0, es: [ 'xxx' ] } ] ],
      expectRight: [ [ 'x', { p: 0 } ], [ 'y', { d: 0, es: [ 1, 'xxx' ] } ] ]}) );

    it('xf lots', () => xf({
      op1: [['a', {p:0}], ['b', {d:0, es:['hi']}]],
      op2: [['a', {p:0}], ['c', {d:0}]],
      expectLeft: [['b', {d:0, es:['hi']}], ['c', {p:0}]],
      expectRight: ['c', {es:['hi']}]}) );

    it('inserts are moved back by the other op', () => xf({
      op1: [['a', {p:0}], ['b', {d:0}, 'x', {i:'hi'}]],
      op2: [['a', {p:0}], ['c', {d:0}]],
      expectLeft: [['b', {d:0}, 'x', {i:'hi'}], ['c', {p:0}]],
      expectRight: ['c', 'x', {i:'hi'}]}) );

    it('more awful edit moves', () => xf({
      op1: [['a', {p:0}], ['c', {d:0}, 'x', {es:[]}]],
      op2: ['a', ['b', {d:0}], ['x', {p:0}]],
      expect: [['a', {p:0}], ['c', {d:0}, 'b', {es:[]}]]}) );

    it('inserts null', () => xf({
      op1: [ 'x', 'a', { i: null } ],
      op2: [ [ 'x', { p: 0 } ], [ 'y', { d: 0 } ] ],
      expect: [ 'y', 'a', { i: null } ]}) );

    it('preserves local insert if both sides delete', () => xf({
      op1: [ { i: {}, r: true }, 'x', { i: 'yo' } ],
      op2: [ { r: true } ],
      expect: [ { i: {} }, 'x', { i: 'yo' } ]}) );

    it('handles insert/delete vs move', () => xf({
      op1: [ 'a', { i: {}, r: true }, 'x', { i: 'yo' } ],
      op2: [ [ 'a', { p: 0 } ], [ 'b', { d: 0 } ] ],
      expect: [ [ 'a', { i: {} }, 'x', { i: 'yo' } ], [ 'b', { r: true }, ] ]}) );

    it('insert pushes edit target', () => xf({
      op1: [[ 0, { i: "yo" } ], [ 1, 'a', { es: [] }]],
      op2: [0, [ 'a', { p: 0 } ], [ 'b', { d: 0 } ]],
      expect: [[0, { i: 'yo' }], [1, 'b', { es: [] }]]}) );

    it('composes simple regression', function() {
      compose({
        op1: [ 0, { p: 0, d: 0 } ],
        op2: [ { r: true } ],
        expect: [ { r: true }, 0, { r: true } ]});

      return compose({
        op1: [ 'a', 1, { r: true } ],
        op2: [ 'a', { r: true } ],
        expect: [ 'a', { r: true }, 1, { r: true } ]});
  });

    it('ignores op2 inserts for index position after op1 insert', () => xf({
      op1: [ { r:true, i: [] }, 0, { i: '' } ],
      op2: [ 0, { i: 0 } ],
      conflict: {
        type: RM_UNEXPECTED_CONTENT,
        op1: [{r:true}]
      },
      expect: [ { r: true, i: [] }, 0, { r:true, i: '' } ]}) );

    it('edit moved inside a removed area should be removed', () => xf({
      op1: [[ 0, { r: true } ], [ 2, { es: [ ] } ]],
      op2: [[ 0, 'x', { d: 0 } ], [ 3, { p: 0 } ]],
      conflict: {
        type: RM_UNEXPECTED_CONTENT,
        op1: [0, {r:true}]
      },
      expect: [ 0, { r: true }, 'x', {r:true} ]}) );

    it('advances indexes correctly with mixed numbers', () => xf({
      op1: [ [ 'x', [ 0, { p: 0 } ], [ 1, { d: 1 } ] ], [ 'y', { p: 1 } ], [ 'zzz', { d: 0 } ] ],
      op2: [ [ 'x', 2, { i: 'hi' } ], [ 'y', { p: 0 } ], [ 'z', { d: 0 } ] ],
      expectLeft: [ [ 'x', [ 0, { p: 1 } ], [ 1, { d: 0 } ] ], [ 'z', { p: 0 } ], [ 'zzz', { d: 1 } ] ],
      expectRight: [ [ 'x', 0, { p: 0 } ], [ 'zzz', { d: 0 } ] ]}) );

    it('handles index positions past cancelled drops 1', () => xf({
      op1: [ 0, { r: true, i: [ '' ] } ],
      op2: [ [ 0, { p: 0, d: 0 } ], [ 1, { i: 23 } ] ],
      expectLeft: [ 0, { r: true, i: [ '' ] } ],
      expectRight: [ [ 0, { r: true } ], [ 1, { i: [ '' ] } ] ]}) );

    it('handles index positions past cancelled drops 2', () => xf({
      // This looks more complicated, but its a simpler version of the above test.
      op1: [ [ 'a', { r: true } ], [ 'b', 0, { i: 'hi' } ] ],
      op2: [ [ 'a', { p: 0 } ], [ 'b', [ 0, { d: 0 } ], [ 1, { i: 'yo' } ] ] ],
      expectLeft: [ 'b', 0, { i: 'hi', r: true } ],
      expectRight: [ 'b', [ 0, { r: true } ], [ 1, { i: 'hi' } ] ]}) );

    it('calculates removed drop indexes correctly', () => xf({
      op1: [ [ 0, { i: 'hi', p: 0 } ], [ 1, 1, { d: 0 } ], [ 2, { r: true } ] ],
      op2: [ [ 0, { i: 'yo', p: 0 } ], [ 1, 1, { d: 0 } ] ],
      expectLeft: [ [ 0, { i: 'hi' } ], [ 1, 1, { p: 0 } ], [ 2, { r: true }, 1, { d: 0 } ] ],
      expectRight: [ [ 1, { i: 'hi' } ], [ 2, { r: true } ] ]}) );

    it('removed drop indexes calc regression', () => xf({
      op1: [ [ 1, { p: 0 }, 'burbled', { d: 0 } ], [ 3, { r: true } ] ],
      op2: [ [ 0, { i: 'to', r: true } ], [ 1, { p: 1 }, [ 'its', { d: 0 } ], [ 'thought', { d: 1 } ] ], [ 3, { p: 0 } ] ],
      expectLeft: [ 1, [ 'burbled', { d: 0 } ], [ 'its', { r: true } ], [ 'thought', { p: 0 } ] ],
      expectRight: [ 1, 'its', { r: true } ]}) );

    it('removed drop indexes tele to op1 pick', () => xf({
      op1: [ 'a', 0, [ 0, { es: [] } ], [ 2, { r: true } ] ],
      op2: [ [ 'a', { p: 0 }, 0, 0, { p: 1 } ], [ 'b', { d: 0 }, 0, 1, 0, { d: 1 } ] ],
      conflict: {
        type: RM_UNEXPECTED_CONTENT,
        op1: ['a', 0, 2, {r:true}],
        op2: [ [ 'a', 0, 0, { p: 0 } ], [ 'b', 0, 1, 0, { d: 0 } ] ]
      },
      expect: [ 'b', 0, 1, { r: true }, 0, { r: true } ]}) );

    it('tracks removed drop index teleports', () => xf({
      // rm 0.a, move 0.b -> 0.c
      doc: [{a:['a'], b:'b'}],
      op1: [ 0, [ 'a', { r: true } ], [ 'b', { p: 0 } ], [ 'c', { d: 0 } ] ], // [{c:'b'}]
      op2: [ 0, { d: 0, p: 1 }, [ 0, { d: 1 } ], [ 'a', { p: 0 } ] ], // [[{b:'b'}, 'a']]
      conflict: {
        type: RM_UNEXPECTED_CONTENT,
        op1: [0, 'a', {r:true}],
        op2: [0, {p:0}, 0, {d:0}]
      },
      expect: [ 0, { r: true }, 0, { r: true } ]}) );

    it('handles transforming past cancelled move', () => xf({
      op1: [ [ 0, { r: true } ], [ 10, { i: [ '' ] } ] ],
      op2: [ 0, { p: 0, d: 0 } ],
      expect: [ [ 0, { r: true } ], [ 10, { i: [ '' ] } ] ]}) );

    it('correctly adjusts indexes in another fuzzer great', () => xf({
      op1: [ [ 0, { d: 0, r: true } ], [ 3, { p: 0 } ] ],
      op2: [ [ 0, { p: 0 } ], [ 3, { d: 0 } ] ],
      expect: [[0, {d:0}], [2, {p:0}], [3, {r:true}]]}) );

    it('op2 moves into something op1 removes and op1 moves into that', () => xf({
      op1: [ [ 'a', { r: true }, 'aa', { p: 0 } ], [ 'b', 'x', { d: 0 } ] ],
      op2: [ [ 'a', 'bb', { d: 0 } ], [ 'b', { p: 0 } ] ],
      conflict: {
        type: RM_UNEXPECTED_CONTENT,
        op1: ['a', {r:true}]
      },
      expect: [ 'a', { r: true }, ['aa', {r:true}], ['bb', {r:true}]]}) ); // Also ok if we miss the second rs.

    it('op2 moves into op1 remove edge cases', function() {
      // Sorry not minified.
      xf({
        op1: [ 'Came', 0, [ 0, { r: true }, 'he', { p: 0 } ], [ 1, { d: 0 }, 0, { i: 'time' } ] ],
        op2: [ 'Came', 0, [ 0, 'he', [ 0, { d: 0 } ], [ 1, { es: [] } ] ], [ 1, { p: 0 } ] ],
        expectLeft: [ 'Came', 0, 0, { r: true, d: 0 }, [ 0, { i: 'time' } ], [ 'he', { p: 0 } ] ],
        expectRight: [ 'Came', 0, 0, { r: true, d: 0 }, [ 1, { i: 'time' } ], [ 'he', { p: 0 } ] ]});

      return xf({
        op1: [ [ 0, [ 1, { p: 0 } ], [ 2, { r: true } ] ], [ 1, 'xxx', { d: 0 } ] ],
        op2: [ 0, 1, { i: {}, p: 0 }, 'b', { d: 0 } ],
        expectLeft: [ [ 0, [ 1, 'b', { p: 0 } ], [ 2, { r: true } ] ], [ 1, 'xxx', { d: 0 } ] ],
        expectRight: [ 0, 2, { r: true } ]});
  });

    it('translates indexes correctly in this fuzzer find', () => xf({
      op1: [ 0, { p: 0 }, 'x', { d: 0 } ],
      op2: [ [ 0, { p: 0, d: 0 } ], [ 1, { i: 'y' } ] ],
      expectLeft: [[0, { p: 0 }], [1, 'x', { d: 0 }]],
      expectRight: null
    })
     );

    it('buries children of blackholed values', () => xf({
      op1: [ [ 0, [ 'a', { p: 0 } ], [ 'b', { d: 0 } ], [ 'c', { d: 1 } ] ], [ 1, { p: 1 } ] ],
      op2: [ 0, { p: 0 }, 'x', { d: 0 } ],
      // This is a bit interesting. The question is, which op2 picks and drops
      // should we include in the output? For now the answer is that we include
      // anything in both ops thats going to end up inside the blackholed
      // content.
      conflict: { type: BLACKHOLE
    },

        // op1: [[0, 'c', d:0], [1, p:0]]
      expect: [ 0, {r: true}, 'x', {r:true} ]}) );

    it('does not conflict when removed target gets moved inside removed container', function() {
      // This edge case is interesting because we don't generate the same
      // conflicts on left and right. We want our move of a.x to escape the
      // object before removing it, but when we're right, the other operation's
      // move holds the object and we get an unexpected rm conflict.
      xf({
        op1: [ [ 'a', { r: true }, 'x', { p: 0 } ], [ 'b', { d: 0 } ] ],
        op2: [ 'a', [ 'x', { p: 0 } ], [ 'y', { d: 0 } ] ],
        conflictRight: {
          type: RM_UNEXPECTED_CONTENT,
          op1: ['a', {r:true}]
        },
        expectLeft: [ [ 'a', { r: true }, 'y', { p: 0 } ], [ 'b', { d: 0 } ] ],
        expectRight: [ 'a', { r: true }, 'y', {r:true}]});

      xf({
        op1: [ [ 'a', { r: true }, 1, { p: 0 } ], [ 'b', { d: 0 } ] ],
        op2: [ 'a', [ 0, { d: 0 } ], [ 1, { p: 0 } ] ],
        expectLeft: [ [ 'a', { r: true }, 0, { p: 0 } ], [ 'b', { d: 0 } ] ],
        conflictRight: {
          type: RM_UNEXPECTED_CONTENT,
          op1: ['a', {r:true}]
        },
        expectRight: [ 'a', { r: true }, 0, {r:true}]});

      return {expect: [ [ 'a', { r: true }, 0, { p: 0 } ], [ 'b', { d: 0 } ] ]};
  });

    it('compose copies op2 edit data', () => compose({
      op1: [ 'a', { r: true } ],
      op2: [ [ 'x', { p: 0 } ], [ 'y', { d: 0 }, 'b', { es: [] } ] ],
      expect: [
        ['a', {r:true}],
        ['x', {p:0}],
        ['y', {d: 0}, 'b', {es: []}]
      ]}) );

    it('does not conflict when the dest is salvaged', () => xf({
      op1: [ [ 'a', { p: 0 } ], [ 'b', { i: 'hi' } ], [ 'c', { d: 0 } ] ],
      op2: [ [ 'a', { p: 0 } ], [ 'b', { d: 0 } ] ],
      expectLeft: [['b', {p:0, i:'hi'}], ['c', {d:0}]],
      conflictRight: {
        type: DROP_COLLISION,
        op1: [ 'b', { i: 'hi' } ]
      },
      expectRight: null
    })
     );

    it('does not conflict on identical r/i pairs', () => xf({
      op1: [{ i: [], r: true }],
      op2: [{ i: [], r: true }],
      expect: null
    })
     );

    it('allows embedded edits in identical r/i', () => xf({
      op1: [ { r: true, i: '', es: [] } ],
      op2: [ { r: true, i: '' } ],
      expect: [{es:[]}]}) );

    it('does not conflict on identical r/i pairs with identical drops inside', () => xf({
      op1: [ { i: {}, r: true }, 'a', { i: 'a' } ],
      op2: [ { i: {}, r: true }, 'a', { i: 'a' } ],
      expect: null
    })
     );

    it('generates a DROP_COLLISION on children', () => xf({
      op1: [ { i: {}, r: true }, 'a', { i: 'a' } ],
      op2: [ { i: {}, r: true }, 'a', { i: 'b' } ],
      conflict: {
        type: DROP_COLLISION,
        op1: ['a', { i: 'a' } ],
        op2: ['a', { i: 'b' } ]
      },
      expectLeft: ['a', {r:true, i:'a'}],
      expectRight: null
    })
     );

    it('Transforms edit moves into the right dest', () => xf({
      op1: [ 0, { p: 0, d: 0 },
        // These parts are all needed for some reason.
        [ 0, { i: 1 } ],
        [ 1, { r: true } ],
        [ 3, { es: [] } ]
      ],
      op2: [ 0, [ 0, { d: 0 } ], [ 3, { p: 0 } ] ],
      expectLeft: [ 0, {p:0, d:0},
        [0, {i:1}],
        [1, {es:[]}],
        [2, {r:true}]
      ],
      expectRight: [0, {p:0, d:0},
        [0, {es:[]}],
        [1, {i:1}],
        [2, {r:true}]
      ]}) );

    it('adjusts indexes of pick -> drop', () => xf({
      op1: [ 0, { p: 0, d: 0 } ],
      op2: [ [ 0, { i: 'yo', p: 0 } ], [ 1, { d: 0 } ] ],
      expectLeft: [ [ 0, { d: 0 } ], [ 1, { p: 0 } ] ],
      expectRight: null
    })
     );

    it('clears output outDrop when theres no pick', () => xf({
      // Again, not minimized. We return the right data, we were just double-
      // descending into outDrop.
      op1: [ [ 'the', { d: 0, p: 0 } ], [ 'toves', { r: true } ] ],
      op2: [
        [ 'bird', { d: 0 } ],
        [ 'slain', { d: 1 } ],
        [ 'the', { p: 1 } ],
        [ 'toves', { p: 0 } ]
      ],
      expectLeft: [
        [ 'bird', { r: true } ],
        [ 'slain', { p: 0 } ],
        [ 'the', { d: 0 } ]
      ],
      expectRight: [ 'bird', { r: true } ]}) );

    it('pushes drop indexes by other held items', () => xf({
      op1: [ [ 0, { p: 0 }],
        [ 1,
          [ 0, { i: 'hi' } ],
          [ 1, { d: 0, es: [] } ] ]
      ],
      op2: [
        [ 0, { p: 1 }, 1, { d: 0 }, 2, { d: 1 } ],
        [ 2, { p: 0 } ]
      ],
      expectLeft: [ 0, 1,
        [ 0, { i: 'hi' } ],
        [ 1, { d: 0, es: [] } ],
        [ 2, { p: 0 } ]
      ],
      expectRight: [ 0, 1, [ 0, { i: 'hi' } ], [ 3, { es: [] } ] ]}) );

    it('composes correctly with lots of removes', () => compose({
      op1: [ 3, 1, { r: true } ],
      op2: [
        [ 0, { es: [] } ],
        [ 1, { r: true, es: [] } ],
        [ 2, { r: true } ]
      ],
      expect: [
        [ 0, { es: [] } ],
        [ 1, { es: [], r: true } ],
        [ 2, { r: true } ],
        [ 3, 1, { r: true } ]
      ]}) );

    it('does not descend twice when p/r on an identical insert', () => xf({
      op1: [ [ 'a', { p: 0, i: '' } ], [ 'b', { d: 0 } ] ],
      op2: [ 'a', { r: true, i: '' } ],
      expect: null
    })
     );

    it('conflicts underneath a moved / inserted child', () => xf({
      op1: [ [ 'a', { p: 0, i: {} }, 'x', {i:5} ], [ 'b', { d: 0 } ] ],
      op2: [ 'a', { r: true, i: {} }, 'x', {i:6} ],
      conflict: {
        type: DROP_COLLISION,
        op1: ['a', 'x', {i:5}],
        op2: ['a', 'x', {i:6}]
      },
      expectLeft: ['a', 'x', {r:true, i:5}],
      expectRight: null
    })
     );

    it('clears drop2 in transform moves', () => xf({
      doc: [{b: {a: 'hi'}}],
      op1: [0, {d:0},
        [ 'a', { es: [] } ],
        [ 'b', { p: 0 } ]
      ],
      op2: [ 0, 'b',
        [ 'a', { p: 0 } ],
        [ 'b', { d: 0 } ]
      ],
      expect: [0, {d:0}, 'b', { p: 0, es:[] }]}) );

    it('descends correctly when op2 picks and drops', () => xf({
      op1: [
        [ 'b', { d: 0 }, [ 1, { es: [] } ], [ 2, { i: null } ] ],
        [ 'e', { p: 0 } ]
      ],
      op2: [ { p: 0, d: 0 }, 'e', 1, { p: 1, d: 1 } ],
      expectLeft: [
        [ 'b', { d: 0 }, [ 1, { i: null } ], [ 2, { es: [] } ]],
        [ 'e', { p: 0 } ]
      ],
      expectRight: [
        [ 'b', { d: 0 }, [ 1, { es: [] } ], [ 2, { i: null } ] ],
        [ 'e', { p: 0 } ]
      ]}) );

    it('composes a pick out of the insert', () => compose({
      op1: [ { i: [ 5, { x: 6 } ] } ],
      op2: [ [ 0, { r: true }, 'c', { d: 0 } ], [ 1, 'x', { p: 0 } ] ],
      // expect: [{i: [{c: 6}]}]
      expect: [ { i: [ {} ] }, 0, 'c', { i: 6 } ]}) );

    it('is not overeager to remove intermediate literal array items', () => compose({
      op1: [ [ 0, { i: [ 'a', 'b' ] }, 0, { p: 0 } ], [ 1, 0, { d: 0 } ] ],
      op2: [ 0, { r: ['a'] }, 1, { r: 'b' } ],
      expect: [ 0, 0, { d: 0, p: 0 } ]}) );

    it('descends down insert indexes correctly', () => compose({
      op1: [ { i: [ {}, 'a' ] }, 1, { i: 'b' } ],
      op2: [ [ 1, { r: 'b' } ], [ 2, { r: 'a' } ] ],
      expect: [ { i: [ {} ] } ]}) );

    it('handles composes with ena: 0', () => compose({
      op1: [{i:10}],
      op2: [{ena:0}],
      expect: [{i:10, ena:0}]}) ); // Also ok: just discarding the ena:0.

    it('handles rm parent with cross move', () => compose({
      op1: [ [ 'a', { p: 0 } ], [ 'b', 1, { d: 0 } ] ],
      op2: [ [ 'b', { r: true }, 1, { p: 0 } ], [ 'c', { d: 0 } ]],
      expect: [ [ 'a', { p: 0 } ], [ 'b', { r: true } ], [ 'c', { d: 0 } ] ]}) );

    it('lets you remove children of an op at 2 levels', () => compose({
      op1: [ { i: [ 'a', { x: 'hi' } ] } ],
      op2: [ { r: true }, 1, 'x', { r: true } ],
      expect: null
    })
     );

    it('discards op1 inserts inside a removed chunk', () => compose({
      op1: [ 'y', [ 1, { i: 'x' } ], [ 2, { i: [ 'a', 'b' ] } ] ],
      op2: [ { r: true }, 'y', 2, 0, { r: true } ],
      expect: [ { r: true } ]}) );

    it('handles deeply nested blackhole operations', () => xf({
      op1: [
        [ 'x', { p: 0 } ],
        [ 'y',
          [ 'a',
            [ 'j', { p: 1 } ],
            [ 'k', { d: 1 } ]
          ],
          [ 'b', { d: 0 }]
        ]
      ],
      op2: [
        [ 'x', 'xx', { d: 0 }, 'j', 'jj', { d: 1 } ],
        [ 'y', { p: 1 }, 'a', { p: 0 } ]
      ],
      conflict: { type: BLACKHOLE
    },
      expect: ['x', {r:true}, 'xx', {r:true}, 'j', 'jj', {r:true}]}) );

    it('does not list removed op1 moves in the blackhole info', () => xf({
      op1: [
        [ 'a', [ 'j', { d: 0 } ], [ 'k', { d: 1 } ] ],
        [ 'b', { p: 0 }, 'z', 0, { p: 1 } ]
      ],
      op2: [
        [ 'a', { p: 0 } ],
        [ 'b', [ 'y', { d: 0 } ], [ 'z', { r: true } ] ]
      ],
      conflict: {
        type: BLACKHOLE,
        op1: [ [ 'a', 'j', { d: 0 } ], [ 'b', { p: 0 } ] ],
        op2: [ [ 'a', { p: 0 } ], [ 'b', 'y', { d: 0 } ] ]
      },
      expect: ['b', {r:true}, 'y', {r:true}]}) );

    return it('handles overlapping pick in blackholes', () => xf({
      // This looks complicated, but its really not so bad. Its:
      // a->b.0, a.x -> z
      // vs
      // b -> a.x -> a.y
      //
      // Its a bit twisty because we're both picking up the same element and
      // putting it in different places. This is why we have different left and
      // right results.
      op1: [
        [ 'a', { p: 1 }, 'x', { p: 0 } ],
        [ 'b', 0, { d: 1 } ],
        [ 'z', { d: 0 } ]
      ],
      op2: [
        [ 'a', [ 'x', { d: 0, p: 1 } ], [ 'y', { d: 1 } ] ],
        [ 'b', { p: 0 } ]
      ],
      conflictLeft: {
        type: BLACKHOLE,
        op1: [['a', {p:0}], ['b', 0, {d:0}]],
        op2: [['a', 'x', {d:0}], ['b', {p:0}]]
      },
      expectLeft: [
        [ 'a', { r: true },
          [ 'x', { r: true } ],
          [ 'y', { p: 0 } ]
        ],
        [ 'z', { d: 0 } ]
      ],
      conflictRight: {
        type: BLACKHOLE,
        op1: [['a', {p:0}], ['b', 0, {d:0}]]
      },
      expectRight: [ 'a', { r: true },
        [ 'x', { r: true } ],
        [ 'y', { r: true } ]
      ]}) );
});
});
    