import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, describeError } from "../api";
import { endSession } from "../queries";
import { Orb } from "./Alfred";
import { Button, ErrorText } from "./ui";

/** Shown when an invitation link is opened in a browser that is signed in as someone else. */
export function InviteSwitch({ current, invited, onStay }: { current: string; invited: string; onStay: () => void }) {
  const client = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    // The invitation stays in the address, so the sign-in screen opens with that address filled in.
    onSuccess: () => endSession(client),
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <header className="text-center">
        <Orb className="mx-auto mb-4 size-12" />
        <h1 className="text-3xl">Someone else is signed in</h1>
      </header>
      <p className="text-center text-soft">
        This browser is signed in as <strong className="break-all text-ink">{current}</strong>. The invitation you opened is for{" "}
        <strong className="break-all text-ink">{invited}</strong>.
      </p>
      <div className="space-y-3">
        <Button className="w-full" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          Sign out and continue
        </Button>
        <Button className="w-full" variant="secondary" onClick={onStay}>
          Stay signed in as {current}
        </Button>
      </div>
      <ErrorText>{signOut.isError ? describeError(signOut.error) : ""}</ErrorText>
    </main>
  );
}
