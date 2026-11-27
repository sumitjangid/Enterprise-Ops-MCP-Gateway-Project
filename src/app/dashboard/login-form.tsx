"use client";

import { useActionState } from "react";

import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <form action={action} className="login-form">
      <label className="field-label" htmlFor="token">
        Manager token
      </label>
      <input
        id="token"
        name="token"
        type="password"
        autoComplete="current-password"
        required
        maxLength={512}
        className="login-input"
      />
      {state?.error ? (
        <p className="login-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="login-submit"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
