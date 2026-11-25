import { AsyncLocalStorage } from "node:async_hooks";

import type { Identity } from "./auth";

export const requestIdentityStorage = new AsyncLocalStorage<
  Identity | null
>();

export function getRequestIdentity(): Identity | null {
  return requestIdentityStorage.getStore() ?? null;
}
