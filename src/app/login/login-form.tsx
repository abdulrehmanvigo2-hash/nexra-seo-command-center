"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";

const INITIAL: SignInState = { error: null, email: "" };

export function LoginForm({ next }: { next: string }) {
  const [state, submit, pending] = useActionState(signInAction, INITIAL);

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <Field label="Email" htmlFor="login-email">
        <TextInput
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          spellCheck={false}
          required
          defaultValue={state.email}
          autoFocus
          readOnly={pending}
        />
      </Field>

      <Field label="Password" htmlFor="login-password">
        <TextInput
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          readOnly={pending}
        />
      </Field>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-[12px] leading-snug text-critical"
        >
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        size="md"
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        className="w-full justify-center"
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
