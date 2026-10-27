import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api, describeError } from "../api";
import { Button, ErrorText, Field, inputClass } from "../components/ui";
import type { Me } from "../api";

function rememberedEmail(): string {
  try {
    return localStorage.getItem("fin:email") ?? "";
  } catch {
    return "";
  }
}

export function Login() {
  const client = useQueryClient();
  const [email, setEmail] = useState(rememberedEmail);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [viaEmail, setViaEmail] = useState(false);

  const request = useMutation({
    mutationFn: () =>
      api.post("/api/auth/request-code", { email: email.trim(), ...(viaEmail && { channel: "email" }) }),
    onSuccess: () => {
      try {
        localStorage.setItem("fin:email", email.trim());
      } catch {
        // remembering the email is a convenience only
      }
      setCode("");
      setStep("code");
    },
  });

  const verify = useMutation({
    mutationFn: () => api.post<{ user: Me }>("/api/auth/verify-code", { email: email.trim(), code }),
    onSuccess: ({ user }) => client.setQueryData(["me"], user),
  });

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    request.mutate();
  };
  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    verify.mutate();
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold">Finance Tracker</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in with a one-time code</p>
      </header>

      {step === "email" ? (
        <form onSubmit={submitEmail} className="space-y-4">
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-emerald-600"
              checked={viaEmail}
              onChange={(e) => setViaEmail(e.target.checked)}
            />
            Send the code to my email instead of Telegram
          </label>
          <ErrorText>{request.isError ? describeError(request.error) : ""}</ErrorText>
          <Button type="submit" className="w-full" disabled={request.isPending}>
            {request.isPending ? "Sending…" : "Send code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            If <strong>{email}</strong> is registered, a 6-digit code is on its way. It works once and expires in 5
            minutes.
          </p>
          <Field label="6-digit code">
            <input
              className={`${inputClass} text-center text-2xl tracking-[0.4em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <ErrorText>{verify.isError ? describeError(verify.error) : ""}</ErrorText>
          <Button type="submit" className="w-full" disabled={verify.isPending || code.length !== 6}>
            {verify.isPending ? "Checking…" : "Sign in"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => setStep("email")}>
            Use a different email or resend
          </Button>
        </form>
      )}
    </main>
  );
}
