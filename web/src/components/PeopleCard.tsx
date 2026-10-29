import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, describeError } from "../api";
import { useToast } from "./toast";
import { Button, Card, ErrorText, Field, Spinner, inputClass } from "./ui";

interface Member {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
  disabled: boolean;
}
interface Invite {
  id: string;
  email: string;
  name: string | null;
}
interface People {
  members: Member[];
  invites: Invite[];
}

/** Owner only: invite people, remove or restore their access, and delete the data of someone removed. */
export function PeopleCard() {
  const client = useQueryClient();
  const toast = useToast();
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.get<People>("/api/people") });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const refresh = () => client.invalidateQueries({ queryKey: ["people"] });

  const invite = useMutation({
    mutationFn: () => api.post<{ invite: Invite; emailed: boolean }>("/api/people/invites", { email: email.trim(), ...(name.trim() && { name: name.trim() }) }),
    onSuccess: async (r) => {
      setEmail("");
      setName("");
      await refresh();
      toast.show(r.emailed ? `Invitation sent to ${r.invite.email}.` : `Invited ${r.invite.email}, but the email did not go out. Tell them to open the site and sign in.`);
    },
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => api.del(`/api/people/invites/${id}`),
    onSuccess: async () => {
      await refresh();
      toast.show("Invitation withdrawn.");
    },
  });
  const setAccess = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.post(`/api/people/${id}/${on ? "enable" : "disable"}`),
    onSuccess: async (_r, v) => {
      await refresh();
      toast.show(v.on ? "Access restored." : "Access removed. Their data is kept.");
    },
  });
  const erase = useMutation({
    mutationFn: (id: string) => api.del(`/api/people/${id}`),
    onSuccess: async () => {
      await refresh();
      toast.show("Their data was deleted.");
    },
  });

  const error = [invite, withdraw, setAccess, erase].find((m) => m.isError)?.error;

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">People</h2>
      <p className="text-sm text-soft">Only people you invite can sign in. Each has their own private ledger; you cannot see theirs.</p>

      {people.isPending ? (
        <Spinner />
      ) : people.isError ? (
        <ErrorText>Could not load the list. Try again.</ErrorText>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {people.data.members.map((m) => (
              <li key={m.id} className="space-y-2 py-3">
                <p className="min-w-0 truncate font-medium">
                  {m.name}
                  {m.isOwner && <span className="ml-2 text-xs font-normal text-faint">you, the owner</span>}
                  {m.disabled && <span className="ml-2 text-xs font-normal text-bad">access removed</span>}
                </p>
                <p className="truncate text-sm text-soft">{m.email}</p>
                {!m.isOwner && (
                  <div className="flex flex-wrap gap-2">
                    {m.disabled ? (
                      <>
                        <Button variant="secondary" className="min-h-11 py-1.5 text-sm" disabled={setAccess.isPending} onClick={() => setAccess.mutate({ id: m.id, on: true })}>
                          Restore access
                        </Button>
                        <Button
                          variant="danger"
                          className="min-h-11 py-1.5 text-sm"
                          disabled={erase.isPending}
                          onClick={() => {
                            if (window.confirm(`Permanently delete everything ${m.name} has recorded? This cannot be undone.`)) erase.mutate(m.id);
                          }}
                        >
                          Delete their data
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        className="min-h-11 py-1.5 text-sm"
                        disabled={setAccess.isPending}
                        onClick={() => {
                          if (window.confirm(`Remove ${m.name}'s access? They are signed out at once. Their records are kept and you can restore access later.`)) setAccess.mutate({ id: m.id, on: false });
                        }}
                      >
                        Remove access
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {people.data.invites.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-medium">Waiting to sign in</h3>
              <ul className="divide-y divide-line">
                {people.data.invites.map((i) => (
                  <li key={i.id} className="flex min-h-11 items-center justify-between gap-3 py-1">
                    <span className="min-w-0 truncate text-sm">{i.name ? `${i.name} (${i.email})` : i.email}</span>
                    <button type="button" className="min-h-11 shrink-0 px-2 text-sm font-medium text-brand" disabled={withdraw.isPending} onClick={() => withdraw.mutate(i.id)}>
                      Withdraw
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <form
        className="space-y-2 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) invite.mutate();
        }}
      >
        <Field label="Invite someone" hint="They get an email from Alfred with a link. After signing in with a one-time code they can set up their own ledger.">
          <input className={inputClass} type="email" autoComplete="off" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Their name (optional)" hint="Alfred uses it to greet them, in the email and in setup.">
          <input className={inputClass} maxLength={40} autoComplete="off" placeholder="Priya" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" disabled={invite.isPending || !email.trim()}>
          Send invitation
        </Button>
      </form>
      <ErrorText>{error ? describeError(error) : ""}</ErrorText>
    </Card>
  );
}
