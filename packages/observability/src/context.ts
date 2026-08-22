import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Correlation/request/job context helper.
 *
 * A minimal AsyncLocalStorage-based store so a requestId/jobId set once at
 * the edge of a request or job can be read anywhere downstream without
 * threading it through every function signature.
 */
export type ExecutionContext = {
  readonly requestId?: string;
  readonly jobId?: string;
  readonly workspaceId?: string;
  readonly [key: string]: unknown;
};

const storage = new AsyncLocalStorage<ExecutionContext>();

export function runWithContext<T>(context: ExecutionContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): ExecutionContext | undefined {
  return storage.getStore();
}
