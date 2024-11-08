import os from "node:os";
import { describe, it, expect } from "vitest";

import { cutexe, NonZeroExitError } from "~/main";

const isWindows = os.platform() === "win32";

describe("exec", () => {
  it("pid is a number", async () => {
    const proc = cutexe("echo", ["foo"]);
    await proc;
    expect(typeof proc.pid).toBe("number");
  });

  it("exitCode is set correctly", async () => {
    const proc = cutexe("echo", ["foo"]);
    expect(proc.exitCode).toBeUndefined();
    const result = await proc;
    expect(proc.exitCode).toBe(0);
    expect(result.exitCode).toBe(0);
  });

  it("non-zero exitCode throws when throwOnError=true", async () => {
    const proc = cutexe("node", ["-e", "process.exit(1);"], {
      throwOnError: true,
    });
    await expect(proc).rejects.toThrow(NonZeroExitError);
    expect(proc.exitCode).toBe(1);
  });

  it("async iterator gets correct output", async () => {
    const proc = cutexe("node", [
      "-e",
      "console.log('foo'); console.log('bar');",
    ]);
    const lines = [];
    for await (const line of proc) {
      lines.push(line);
    }

    expect(lines).toEqual(["foo", "bar"]);
  });

  it("resolves to stdout", async () => {
    const result = await cutexe("node", ["-e", "console.log('foo')"]);
    expect(result.stdout).toBe("foo\n");
    expect(result.stderr).toBe("");
  });

  it("captures stderr", async () => {
    const result = await cutexe("node", ["-e", "console.error('some error')"]);
    expect(result.stderr).toBe("some error\n");
    expect(result.stdout).toBe("");
  });

  if (isWindows) {
    describe("exec (windows)", () => {
      it("times out after defined timeout (ms)", async () => {
        const proc = cutexe("ping", ["127.0.0.1", "-n", "2"], { timeout: 100 });
        await expect(proc).rejects.toThrow();
        expect(proc.killed).toBe(true);
        expect(proc.process!.signalCode).toBe("SIGTERM");
      });

      it("does not throw spawn errors", async () => {
        const result = await cutexe("definitelyNonExistent");
        expect(result.stderr).toContain(
          "'definitelyNonExistent' is not recognized as an internal",
        );
        expect(result.stdout).toBe("");
      });

      it("throws spawn errors when throwOnError=true", async () => {
        const proc = cutexe("definitelyNonExistent", [], {
          throwOnError: true,
        });
        await expect(proc).rejects.toThrowError(NonZeroExitError);
      });

      it("kill terminates the process", async () => {
        const proc = cutexe("ping", ["127.0.0.1", "-n", "2"]);
        const result = proc.kill();
        expect(result).toBeTruthy();
        expect(proc.killed).toBeTruthy();
        expect(proc.aborted).toBe(false);
      });

      it("pipe correctly pipes output", async () => {
        const echoProc = cutexe("node", ["-e", "console.log('foo')"]);
        const grepProc = echoProc.pipe("findstr", ["f"]);
        const result = await grepProc;

        expect(result.stderr).toBe("");
        expect(result.stdout).toBe("foo\n");
        expect(result.exitCode).toBe(0);
        expect(echoProc.exitCode).toBe(0);
        expect(grepProc.exitCode).toBe(0);
      });

      it("signal can be used to abort execution", async () => {
        const controller = new AbortController();
        const proc = cutexe("ping", ["127.0.0.1", "-n", "2"], {
          signal: controller.signal,
        });
        controller.abort();
        const result = await proc;
        expect(proc.aborted).toBe(true);
        expect(proc.killed).toBe(true);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe("");
      });

      it("async iterator receives errors as lines", async () => {
        const proc = cutexe("nonexistentforsure");
        const lines: string[] = [];
        for await (const line of proc) {
          lines.push(line);
        }

        expect(lines).toEqual([
          "'nonexistentforsure' is not recognized as an internal or " +
            "external command,",
          "operable program or batch file.",
        ]);
      });
    });
  }

  if (!isWindows) {
    describe("exec (unix-like)", () => {
      it("times out after defined timeout (ms)", async () => {
        const proc = cutexe("sleep", ["0.2"], { timeout: 100 });
        await expect(proc).rejects.toThrow();
        expect(proc.killed).toBe(true);
        expect(proc.process!.signalCode).toBe("SIGTERM");
      });

      it("throws spawn errors", async () => {
        const proc = cutexe("definitelyNonExistent");
        await expect(proc).rejects.toThrow("spawn definitelyNonExistent NOENT");
      });

      it("kill terminates the process", async () => {
        const proc = cutexe("sleep", ["5"]);
        const result = proc.kill();
        expect(result).toBeTruthy();
        expect(proc.killed).toBeTruthy();
        expect(proc.aborted).toBe(false);
      });

      it("pipe correctly pipes output", async () => {
        const echoProc = cutexe("echo", ["foo\nbar"]);
        const grepProc = echoProc.pipe("grep", ["foo"]);
        const result = await grepProc;

        expect(result.stderr).toBe("");
        expect(result.stdout).toBe("foo\n");
        expect(result.exitCode).toBe(0);
        expect(echoProc.exitCode).toBe(0);
        expect(grepProc.exitCode).toBe(0);
      });

      it("signal can be used to abort execution", async () => {
        const controller = new AbortController();
        const proc = cutexe("sleep", ["4"], { signal: controller.signal });
        controller.abort();
        const result = await proc;
        expect(proc.aborted).toBe(true);
        expect(proc.killed).toBe(true);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe("");
      });

      it("async iterator receives errors", async () => {
        const proc = cutexe("nonexistentforsure");
        await expect(async () => {
          for await (const line of proc) {
            line;
          }
        }).rejects.toThrow();
      });
    });
  }
});
