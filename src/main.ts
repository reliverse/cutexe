import { _parse } from "cross-spawn";
import {
  type ChildProcess,
  type SpawnOptions,
  spawn,
} from "node:child_process";
import { cwd as getCwd } from "node:process";
import readline from "node:readline";
import { type Readable } from "node:stream";
import { normalize as normalizePath } from "pathe";

import { computeEnv } from "~/utils/env";
import { NonZeroExitError } from "~/utils/non-zero-exit-error";
import { combineStreams } from "~/utils/stream";

export { NonZeroExitError };

export type Output = {
  stderr: string;
  stdout: string;
  exitCode: number | undefined;
};

export type PipeOptions = {} & Options;

export type KillSignal = Parameters<ChildProcess["kill"]>[0];

export type OutputApi = {
  pipe(
    command: string,
    args?: string[],
    options?: Partial<PipeOptions>,
  ): Result;
  process: ChildProcess | undefined;
  kill(signal?: KillSignal): boolean;

  get pid(): number | undefined;
  get aborted(): boolean;
  get killed(): boolean;
  get exitCode(): number | undefined;
} & AsyncIterable<string>;

export type Result = PromiseLike<Output> & OutputApi;

export type Options = {
  signal: AbortSignal;
  nodeOptions: SpawnOptions;
  timeout: number;
  persist: boolean;
  stdin: ExecProcess;
  throwOnError: boolean;
};

export type Cutexe = (
  command: string,
  args?: string[],
  options?: Partial<Options>,
) => Result;

const defaultOptions: Partial<Options> = {
  timeout: undefined,
  persist: false,
};

const defaultNodeOptions: SpawnOptions = {
  windowsHide: true,
};

function normaliseCommandAndArgs(
  command: string,
  args?: string[],
): {
  command: string;
  args: string[];
} {
  const normalisedPath = normalizePath(command);
  const normalisedArgs = args ?? [];

  return {
    command: normalisedPath,
    args: normalisedArgs,
  };
}

function combineSignals(signals: Iterable<AbortSignal>): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return signal;
    }

    const onAbort = (): void => {
      controller.abort(signal.reason);
    };
    signal.addEventListener("abort", onAbort, {
      signal: controller.signal,
    });
  }

  return controller.signal;
}

export class ExecProcess implements Result {
  protected _process?: ChildProcess;
  protected _aborted = false;
  protected _options: Partial<Options>;
  protected _command: string;
  protected _args: string[];
  protected _resolveClose?: () => void;
  protected _processClosed: Promise<void>;
  protected _thrownError?: Error;

  public get process(): ChildProcess | undefined {
    return this._process;
  }

  public get pid(): number | undefined {
    return this._process?.pid;
  }

  public get exitCode(): number | undefined {
    if (
      this._process?.exitCode !== null &&
      this._process?.exitCode !== undefined
    ) {
      return this._process.exitCode;
    }
    return undefined;
  }

  public constructor(
    command: string,
    args?: string[],
    options?: Partial<Options>,
  ) {
    this._options = {
      ...defaultOptions,
      ...options,
    };
    this._command = command;
    this._args = args ?? [];
    this._processClosed = new Promise<void>((resolve) => {
      this._resolveClose = resolve;
    });
  }

  public kill(signal?: KillSignal): boolean {
    return this._process?.kill(signal) === true;
  }

  public get aborted(): boolean {
    return this._aborted;
  }

  public get killed(): boolean {
    return this._process?.killed === true;
  }

  public pipe(
    command: string,
    args?: string[],
    options?: Partial<PipeOptions>,
  ): Result {
    return exec(command, args, {
      ...options,
      stdin: this,
    });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    const proc = this._process;

    if (!proc) {
      return;
    }

    const streams: Readable[] = [];

    if (this._streamErr) {
      streams.push(this._streamErr);
    }
    if (this._streamOut) {
      streams.push(this._streamOut);
    }

    const streamCombined = combineStreams(streams);

    const rl = readline.createInterface({
      input: streamCombined,
    });

    for await (const chunk of rl) {
      yield chunk.toString();
    }

    await this._processClosed;

    proc.removeAllListeners();

    if (this._thrownError) {
      throw this._thrownError;
    }

    if (
      this._options?.throwOnError &&
      this.exitCode !== 0 &&
      this.exitCode !== undefined
    ) {
      throw new NonZeroExitError(this);
    }
  }

  protected async _waitForOutput(): Promise<Output> {
    const proc = this._process;

    if (!proc) {
      throw new Error("No process was started");
    }

    let stderr = "";
    let stdout = "";

    if (this._streamErr) {
      for await (const chunk of this._streamErr) {
        stderr += String(chunk);
      }
    }

    if (this._streamOut) {
      for await (const chunk of this._streamOut) {
        stdout += String(chunk);
      }
    }

    await this._processClosed;

    if (this._options?.stdin) {
      await this._options.stdin;
    }

    proc.removeAllListeners();

    if (this._thrownError) {
      throw this._thrownError;
    }

    const result: Output = {
      stderr,
      stdout,
      exitCode: this.exitCode,
    };

    if (
      this._options.throwOnError &&
      this.exitCode !== 0 &&
      this.exitCode !== undefined
    ) {
      throw new NonZeroExitError(this, result);
    }

    return result;
  }

  public then<TResult1 = Output, TResult2 = never>(
    onfulfilled?: ((value: Output) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this._waitForOutput().then(onfulfilled, onrejected);
  }

  protected _streamOut?: Readable;
  protected _streamErr?: Readable;

  public spawn(): void {
    const cwd = getCwd();
    const options = this._options;
    const nodeOptions = {
      ...defaultNodeOptions,
      ...options.nodeOptions,
    };
    const signals: AbortSignal[] = [];

    this._resetState();

    if (options.timeout !== undefined) {
      signals.push(AbortSignal.timeout(options.timeout));
    }

    if (options.signal !== undefined) {
      signals.push(options.signal);
    }

    if (options.persist === true) {
      nodeOptions.detached = true;
    }

    if (signals.length > 0) {
      nodeOptions.signal = combineSignals(signals);
    }

    nodeOptions.env = computeEnv(cwd, nodeOptions.env);

    const { command: normalisedCommand, args: normalisedArgs } =
      normaliseCommandAndArgs(this._command, this._args);

    const crossResult = _parse(normalisedCommand, normalisedArgs, nodeOptions);

    const handle = spawn(
      crossResult.command,
      crossResult.args,
      crossResult.options,
    );

    if (handle.stderr) {
      this._streamErr = handle.stderr;
    }
    if (handle.stdout) {
      this._streamOut = handle.stdout;
    }

    this._process = handle;
    handle.once("error", this._onError);
    handle.once("close", this._onClose);

    if (options.stdin !== undefined && handle.stdin && options.stdin.process) {
      const { stdout } = options.stdin.process;
      if (stdout) {
        stdout.pipe(handle.stdin);
      }
    }
  }

  protected _resetState(): void {
    this._aborted = false;
    this._processClosed = new Promise<void>((resolve) => {
      this._resolveClose = resolve;
    });
    this._thrownError = undefined;
  }

  protected _onError = (err: Error): void => {
    if (
      err.name === "AbortError" &&
      (!(err.cause instanceof Error) || err.cause.name !== "TimeoutError")
    ) {
      this._aborted = true;
      return;
    }
    this._thrownError = err;
  };

  protected _onClose = (): void => {
    if (this._resolveClose) {
      this._resolveClose();
    }
  };
}

export const cutexe: Cutexe = (command, args, userOptions) => {
  const proc = new ExecProcess(command, args, userOptions);

  proc.spawn();

  return proc;
};

export const exec = cutexe;
