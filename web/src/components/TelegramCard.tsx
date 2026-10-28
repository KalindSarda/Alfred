import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, describeError } from "../api";
import { useMe } from "../queries";
import { useToast } from "./toast";
import { Button, Card, ErrorText } from "./ui";

/** Link or unlink the Telegram chat Alfred talks to. A code is shown once and works for ten minutes. */
export function TelegramCard() {
  const client = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const linked = Boolean(me.data?.telegramLinked);
  const [code, setCode] = useState<string | null>(null);

  const createCode = useMutation({
    mutationFn: () => api.post<{ code: string; expiresAt: string }>("/api/telegram/link-code"),
    onSuccess: (data) => setCode(data.code),
  });

  const unlink = useMutation({
    mutationFn: () => api.del("/api/telegram/link"),
    onSuccess: async () => {
      setCode(null);
      await client.invalidateQueries({ queryKey: ["me"] });
      toast.show("Telegram unlinked");
    },
  });

  // While a code is showing, watch for the moment you send it to Alfred.
  useEffect(() => {
    if (!code || linked) return;
    const id = window.setInterval(() => void client.invalidateQueries({ queryKey: ["me"] }), 3000);
    return () => window.clearInterval(id);
  }, [code, linked, client]);

  useEffect(() => {
    if (linked && code) {
      setCode(null);
      toast.show("Telegram linked. Alfred will answer there.");
    }
  }, [linked, code, toast]);

  return (
    <Card className="space-y-3">
      <h2 className="font-medium">Telegram</h2>
      {linked ? (
        <>
          <p className="text-sm text-soft">Linked. Alfred answers in that chat and ignores every other.</p>
          <Button
            variant="secondary"
            disabled={unlink.isPending}
            onClick={() => {
              if (window.confirm("Unlink Telegram? Alfred will stop answering that chat.")) unlink.mutate();
            }}
          >
            Unlink Telegram
          </Button>
        </>
      ) : code ? (
        <div className="space-y-3">
          <p className="text-sm text-soft">Open Alfred in Telegram and send him this message:</p>
          <p className="font-mono text-2xl tracking-wider select-all" aria-label="Link message">
            /start {code}
          </p>
          <p className="text-xs text-faint">It works once and expires in ten minutes. This page will notice when it is done.</p>
          <Button variant="secondary" onClick={() => setCode(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-soft">Not linked yet. Link your chat to log entries, ask questions and get reminders from Alfred.</p>
          <Button disabled={createCode.isPending} onClick={() => createCode.mutate()}>
            Link Telegram
          </Button>
        </>
      )}
      <ErrorText>{createCode.isError ? describeError(createCode.error) : unlink.isError ? describeError(unlink.error) : ""}</ErrorText>
    </Card>
  );
}
