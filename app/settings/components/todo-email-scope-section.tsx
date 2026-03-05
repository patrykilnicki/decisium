"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface GmailLabel {
  id: string;
  name: string;
}

interface TodoEmailScope {
  labelIdsAccepted?: string[];
  labelIdsBlocked?: string[];
  sendersAccepted?: string[];
  sendersBlocked?: string[];
}

function parseSendersText(text: string): string[] {
  return text
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sendersToText(senders: string[] | undefined): string {
  return (senders ?? []).join("\n");
}

export function TodoEmailScopeSection() {
  const [gmailConnected, setGmailConnected] = useState(false);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [scope, setScope] = useState<TodoEmailScope>({});
  const [scopeLoading, setScopeLoading] = useState(true);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations");
      if (!res.ok) return;
      const data = await res.json();
      const gmail = (
        data.integrations as { provider: string; status: string }[]
      ).find((i: { provider: string }) => i.provider === "gmail");
      setGmailConnected(gmail?.status === "active");
    } catch {
      setGmailConnected(false);
    } finally {
      setIntegrationsLoading(false);
    }
  }, []);

  const fetchScope = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/todo-email-scope");
      if (!res.ok) return;
      const data = await res.json();
      setScope({
        labelIdsAccepted: data.labelIdsAccepted ?? [],
        labelIdsBlocked: data.labelIdsBlocked ?? [],
        sendersAccepted: data.sendersAccepted ?? [],
        sendersBlocked: data.sendersBlocked ?? [],
      });
    } catch {
      setScope({});
    } finally {
      setScopeLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  useEffect(() => {
    if (gmailConnected) fetchScope();
    else setScopeLoading(false);
  }, [gmailConnected, fetchScope]);

  useEffect(() => {
    if (notification) {
      const t = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(t);
    }
  }, [notification]);

  const fetchLabels = useCallback(async () => {
    setLabelsLoading(true);
    try {
      const res = await fetch("/api/integrations/gmail/labels");
      if (!res.ok) {
        const err = await res.json();
        setNotification({
          type: "error",
          message: err.error ?? "Failed to load labels",
        });
        return;
      }
      const data = await res.json();
      setLabels(data.labels ?? []);
    } catch {
      setNotification({ type: "error", message: "Failed to load labels" });
    } finally {
      setLabelsLoading(false);
    }
  }, []);

  const toggleLabelAccepted = useCallback((id: string, checked: boolean) => {
    setScope((prev) => {
      const list = prev.labelIdsAccepted ?? [];
      const next = checked ? [...list, id] : list.filter((x) => x !== id);
      return { ...prev, labelIdsAccepted: next };
    });
  }, []);

  const toggleLabelBlocked = useCallback((id: string, checked: boolean) => {
    setScope((prev) => {
      const list = prev.labelIdsBlocked ?? [];
      const next = checked ? [...list, id] : list.filter((x) => x !== id);
      return { ...prev, labelIdsBlocked: next };
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body = {
        labelIdsAccepted: scope.labelIdsAccepted ?? [],
        labelIdsBlocked: scope.labelIdsBlocked ?? [],
        sendersAccepted: scope.sendersAccepted ?? [],
        sendersBlocked: scope.sendersBlocked ?? [],
      };
      const res = await fetch("/api/settings/todo-email-scope", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to save");
      }
      setNotification({ type: "success", message: "Settings saved" });
    } catch (e) {
      setNotification({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  }, [scope]);

  if (integrationsLoading || !gmailConnected) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Zakres maili do zadań to-do</h2>
        <p className="text-sm text-muted-foreground">
          Określ, z jakich e-maili mogą powstawać zadania na stronie Główna.
          Dozwolone listy ograniczają źródła; zablokowane wykluczają. Puste
          listy = brak filtra.
        </p>
      </div>

      {notification && (
        <div
          className={cn(
            "rounded-lg p-3 text-sm",
            notification.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200 dark:bg-green-950/50 dark:text-green-200 dark:border-green-800"
              : "bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/50 dark:text-red-200 dark:border-red-800",
          )}
        >
          {notification.message}
        </div>
      )}

      {scopeLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {/* Labels */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="text-base font-medium">Etykiety Gmail</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fetchLabels}
                disabled={labelsLoading}
              >
                {labelsLoading ? "Ładowanie…" : "Pobierz etykiety"}
              </Button>
            </div>
            {labels.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 rounded-md border p-3">
                  <Label className="text-sm font-medium">
                    Dozwolone (accepted)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Tylko maile z co najmniej jedną z tych etykiet
                  </p>
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {labels.map((l) => (
                      <label
                        key={l.id}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={(scope.labelIdsAccepted ?? []).includes(
                            l.id,
                          )}
                          onCheckedChange={(c) =>
                            toggleLabelAccepted(l.id, c === true)
                          }
                        />
                        <span className="truncate">{l.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2 rounded-md border p-3">
                  <Label className="text-sm font-medium">
                    Zablokowane (block)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Wyklucz maile mające którąkolwiek z tych etykiet
                  </p>
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {labels.map((l) => (
                      <label
                        key={l.id}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={(scope.labelIdsBlocked ?? []).includes(l.id)}
                          onCheckedChange={(c) =>
                            toggleLabelBlocked(l.id, c === true)
                          }
                        />
                        <span className="truncate">{l.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Senders */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Nadawcy</Label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Dozwoleni (accepted)
                </Label>
                <Textarea
                  placeholder="jeden adres e-mail na linię"
                  value={sendersToText(scope.sendersAccepted)}
                  onChange={(e) =>
                    setScope((prev) => ({
                      ...prev,
                      sendersAccepted: parseSendersText(e.target.value),
                    }))
                  }
                  rows={3}
                  className="resize-none font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Zablokowani (block)
                </Label>
                <Textarea
                  placeholder="jeden adres e-mail na linię"
                  value={sendersToText(scope.sendersBlocked)}
                  onChange={(e) =>
                    setScope((prev) => ({
                      ...prev,
                      sendersBlocked: parseSendersText(e.target.value),
                    }))
                  }
                  rows={3}
                  className="resize-none font-mono text-sm"
                />
              </div>
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </>
      )}
    </div>
  );
}
