const assert = require("assert");
const Delta = require("quill-delta");
const { type } = require("../dist/json1.release");

type.registerSubtype(require("rich-text"));

describe("presences", () => {
  it("transforms json1 only presences", () => {
    const op = ["z", 0, { i: "hello" }];
    const presenceBefore = { start: ["z", 0], end: ["z", 1] };
    const presenceAfter = { start: ["z", 1], end: ["z", 2] };

    assert.deepStrictEqual(
      type.transformPresence(presenceBefore, op),
      presenceAfter
    );
  });

  it("transforms json1 + text-unicode presences", () => {
    const op = ["z", [0, { i: "hello" }], [2, { es: ["hi"] }]];
    const presenceBefore = { start: ["z", 1, 1], end: ["z", 2, 0] };
    const presenceAfter = { start: ["z", 2, 3], end: ["z", 3, 0] };

    assert.deepStrictEqual(
      type.transformPresence(presenceBefore, op),
      presenceAfter
    );
  });

  it("transforms json1 + rich-text presences", () => {
    const op = [
      "z",
      [0, { i: "hello" }],
      [4, { et: "rich-text", e: new Delta([{ insert: "bye" }]) }],
    ];
    const presenceBefore = { start: ["z", 3, 1], end: ["z", 4, 0] };
    const presenceAfter = { start: ["z", 4, 4], end: ["z", 5, 0] };

    assert.deepStrictEqual(
      type.transformPresence(presenceBefore, op),
      presenceAfter
    );
  });

  it("does nothing on null presences", () => {
    const op = ["z", 0, { i: "hello" }];

    assert.deepStrictEqual(type.transformPresence(null, op), null);
  });

  it("returns null on missing start or end", () => {
    const op = ["z", 0, { i: "hello" }];

    assert.deepStrictEqual(
      type.transformPresence({ start: null, end: [] }, op),
      null
    );

    assert.deepStrictEqual(
      type.transformPresence({ start: [], end: null }, op),
      null
    );
  });

  it("returns collapsed presence when start container is removed", () => {
    const op = ["z", 0, { r: true }];
    const presenceBefore = { start: ["z", 0], end: ["z", 1] };
    const presenceAfter = { start: ["z", 0], end: ["z", 0] };

    assert.deepStrictEqual(
      type.transformPresence(presenceBefore, op),
      presenceAfter
    );
  });

  it("returns collapsed presence when end container is removed", () => {
    const op = ["z", 1, { r: true }];
    const presenceBefore = { start: ["z", 0], end: ["z", 1] };
    const presenceAfter = { start: ["z", 0], end: ["z", 0] };

    assert.deepStrictEqual(
      type.transformPresence(presenceBefore, op),
      presenceAfter
    );
  });

  it("allows arbitrary data in presences", () => {
    const op = ["z", 0, { i: "hello" }];
    const data = { user: "John Doe", color: "blue" };
    const presenceBefore = { start: ["z", 0], end: ["z", 1], data };
    const presenceAfter = type.transformPresence(presenceBefore, op);

    assert.ok(presenceBefore.data === presenceAfter.data);
  });
});
