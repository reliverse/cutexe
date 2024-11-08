import process from "node:process";
import { sep as pathSep } from "pathe";
import { describe, it, expect, afterEach } from "vitest";

import { computeEnv } from "~/utils/env";

const pathKey = "Path" in process.env ? "Path" : "PATH";

describe("computeEnv", () => {
  afterEach(() => {
    process.env[pathKey] = originalPath;
  });

  const originalPath = process.env[pathKey];

  it("adds node binaries to path", () => {
    const env = computeEnv(process.cwd());
    const path = env[pathKey]!;
    expect(path.includes(`node_modules${pathSep}.bin`)).toBe(true);
  });

  it("extends process env", () => {
    const env = computeEnv(process.cwd(), {
      foo: "bar",
    });

    for (const key in process.env) {
      if (key.toUpperCase() !== "PATH") {
        expect(env[key]).toBe(process.env[key]);
      }
    }

    expect(env.foo).toBe("bar");
  });

  it("supports case-insensitive path keys", () => {
    delete process.env[pathKey];
    const env = computeEnv(process.cwd(), {
      PatH: "/",
    });
    const keys = [...Object.keys(env)];

    expect(keys.includes("PatH")).toBe(true);
    expect(keys.includes(pathKey)).toBe(false);
  });

  it("uses default key if empty path found", () => {
    delete process.env[pathKey];
    const env = computeEnv(process.cwd(), {
      PatH: undefined,
    });

    expect(typeof env.PATH).toBe("string");
    expect(env.PatH).toBe(undefined);
  });

  it("uses default key if no path found", () => {
    delete process.env[pathKey];
    const env = computeEnv(process.cwd());

    expect(typeof env.PATH).toBe("string");
  });
});
