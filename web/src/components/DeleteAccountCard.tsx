import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, describeError } from "../api";
import { endSession, useMe } from "../queries";
import { useToast } from "./toast";
import { Button, Card, ErrorText, Field, inputClass } from "./ui";

/** Anyone but the owner can delete their own account. They confirm by typing their email. */
export function DeleteAccountCard() {
  const client = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [typed, setTyped] = useState("");
  const email = me.data?.email ?? "";
  const matches = typed.trim().toLowerCase() === email.toLowerCase() && email !== "";

  const erase = useMutation({
    mutationFn: () => api.del("/api/me", { email: typed.trim() }),
    onSuccess: () => {
      endSession(client);
      toast.show("Your account and everything in it has been deleted.");
    },
  });

  if (me.data?.isOwner) {
    return (
      <Card className="space-y-2">
        <h2 className="font-medium">Delete my account</h2>
        <p className="text-sm text-soft">The owner&apos;s account cannot be deleted here.</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-medium">Delete my account</h2>
      <p className="text-sm text-soft">
        This removes your accounts and cards, every entry, your categories and budgets, and your Telegram link. It cannot be undone. Download your data first if you want to keep a copy.
      </p>
      <div className="flex flex-wrap gap-3">
        {[
          { href: "/api/export/json", label: "Download backup (JSON)" },
          { href: "/api/export/csv", label: "Download spreadsheet (CSV)" },
        ].map((l) => (
          <a key={l.href} href={l.href} download className="flex min-h-11 items-center rounded-xl border border-line bg-card px-4 py-2.5 text-base font-medium text-ink hover:bg-hover">
            {l.label}
          </a>
        ))}
      </div>
      <Field label="Type your email address to confirm" hint={email}>
        <input className={inputClass} type="email" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Field>
      <Button variant="danger" disabled={!matches || erase.isPending} onClick={() => erase.mutate()}>
        Delete my account
      </Button>
      <ErrorText>{erase.isError ? describeError(erase.error) : ""}</ErrorText>
    </Card>
  );
}
