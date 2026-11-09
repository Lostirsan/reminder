"use client";

import { useActionState } from "react";
import { signInWithEmail, verifyEmailCode } from "../actions";
import { SubmitButton } from "@/components/ActionForm";
import { inputClass } from "@/components/ui";
import type { ActionState } from "@/lib/types";

type Labels = { emailPlaceholder: string; emailButton: string; codeLabel: string; codeButton: string; otherEmail: string };

// Step 1: email → we send a message with a 6-digit code (and a sign-in link).
// Step 2: type the code here. The link in the email also still works.
export function EmailLogin({ next, labels }: { next: string; labels: Labels }) {
  const [sent, sendAction] = useActionState<ActionState, FormData>(signInWithEmail, undefined);
  const [checked, verifyAction] = useActionState<ActionState, FormData>(verifyEmailCode, undefined);
  const email = checked?.email ?? sent?.email;

  if (!email) {
    return (
      <form action={sendAction} className="space-y-3">
        <input name="email" type="email" required autoComplete="email" placeholder={labels.emailPlaceholder} className={inputClass} />
        <SubmitButton>{labels.emailButton}</SubmitButton>
        {sent?.error && <p className="text-sm text-red-600 dark:text-red-400">{sent.error}</p>}
      </form>
    );
  }
  return (
    <div className="space-y-3">
      {sent?.ok && <p className="text-sm text-emerald-700 dark:text-emerald-400">{sent.ok}</p>}
      <form action={verifyAction} className="space-y-3">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {labels.codeLabel}
          <input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={10} autoFocus
            placeholder="123456" className={`${inputClass} mt-1 text-center text-lg tracking-[0.4em]`} />
        </label>
        <SubmitButton>{labels.codeButton}</SubmitButton>
        {checked?.error && <p className="text-sm text-red-600 dark:text-red-400">{checked.error}</p>}
      </form>
      <a href={`/login?next=${encodeURIComponent(next)}`} className="block text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200">{labels.otherEmail}</a>
    </div>
  );
}
