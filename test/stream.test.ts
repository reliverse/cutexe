import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, it, expect } from "vitest";

import { combineStreams, waitForEvent } from "~/utils/stream";

describe("waitForEvent", () => {
  it("waits for event to fire", async () => {
    const emitter = new EventEmitter();
    const waiter = waitForEvent(emitter, "foo");
    emitter.emit("foo");
    await waiter;
  });
});

describe("combineStreams", () => {
  it("works with a single stream", async () => {
    const stream = Readable.from(["foo", "bar"]);
    const combined = combineStreams([stream]);
    const chunks: string[] = [];
    combined.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });
    await waitForEvent(combined, "end");
    expect(chunks).toEqual(["foo", "bar"]);
  });

  it("works with multiple streams", async () => {
    const stream0 = Readable.from(["foo"]);
    const stream1 = Readable.from(["bar", "baz"]);
    const combined = combineStreams([stream0, stream1]);
    const chunks: string[] = [];
    combined.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });
    await waitForEvent(combined, "end");
    expect(chunks).toEqual(["foo", "bar", "baz"]);
  });
});
