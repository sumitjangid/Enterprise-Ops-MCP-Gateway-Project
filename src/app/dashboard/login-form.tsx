"use client";

import { useActionState } from "react";

import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block text-sm font-medium" htmlFor="token">
        Manager token
      </label>
      <input
        id="token"
        name="token"
        type="password"
        autoComplete="current-password"
        required
        maxLength={512}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2"
      />
      {state?.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
