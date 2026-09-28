// Quiet Ledger style reminder: Today is the operational briefing; every other screen supports the path from promise to recovered money.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowUpRight, Ban, CalendarDays, ChevronRight, CircleCheck, Download, Filter, KeyRound, LockKeyhole, MessageCircle, Moon, Pencil, Plus, RotateCw, Search, SearchX, Settings2, ShieldCheck, Sparkles, Sun, Undo2, User, WalletCards, Zap } from "lucide-react";
import { feedback } from "@/components/ui/sonner";
import { BRAND } from "@/config/brand";
import { SupabaseActivityRepository } from "@/data/supabase-activity-repository";
import { SupabaseClientRepository } from "@/data/supabase-client-repository";
import { SupabaseDashboardRepository } from "@/data/supabase-dashboard-repository";
import { SupabaseDataExportRepository } from "@/data/supabase-data-export-repository";
import { SupabasePaymentRepository } from "@/data/supabase-payment-repository";
import { SupabasePromiseRepository } from "@/data/supabase-promise-repository";
import { SupabaseReceivableRepository } from "@/data/supabase-receivable-repository";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { useWorkspaceProfile } from "@/contexts/WorkspaceProfileContext";
import { daysBetween, formatDate, formatINR, getClient, getLatestPromise, getOutstanding, getPromiseStatusLabel, getPromisesFor, getQueue, priorityBreakdown, priorityReasons } from "@/lib/finance";
import { FOUNDER_PRICE_PAISE } from "@/lib/founder-readiness";
import { todayInIndia } from "@/lib/business-clock";
import { buildExportBundle, csvFor, exportFilename, EXPORT_CSV_MIME, EXPORT_JSON_MIME, serializeExportBundle, withByteOrderMark, type ExportKind } from "@/lib/data-export";
import { downloadGeneratedFile } from "@/lib/download";
import { countReceivablesByStatus, selectClients, selectReceivables, type ReceivableStatusFilter } from "@/lib/ledger-search";
import type { AppSection, LedgerState, Receivable } from "@/types/domain";
import { AppRail, BottomNav, EmptyStateCard, ErrorState, LoadingState, Metric, PageHeader, QueueCard, Reliability, StatusPill, Timeline } from "@/components/finance-ui";
import { AddClientSheet, AddPromiseSheet, AddReceivableSheet, type PaymentSubmitInput, type PromiseSubmitInput, type ReceivableSubmitInput, CloseReceivableSheet, EditClientSheet, EditProfileSheet, EditReceivableSheet, FollowUpSheet, PaymentSheet, SnoozeSheet, WithdrawPromiseSheet } from "@/components/sheets";

function App() {
  const { user, signOut, resetPassword } = useSupabaseAuth();
  const { profile, saveWorkspace, reload } = useWorkspaceProfile();
  const [, navigateTo] = useLocation();
  const [active, setActive] = useState<AppSection>("today");
  const [dashboardRepository] = useState(() => new SupabaseDashboardRepository());
  const [clientRepository] = useState(() => new SupabaseClientRepository());
  const [receivableRepository] = useState(() => new SupabaseReceivableRepository());
  const [promiseRepository] = useState(() => new SupabasePromiseRepository());
  const [paymentRepository] = useState(() => new SupabasePaymentRepository());
  const [activityRepository] = useState(() => new SupabaseActivityRepository());
  const [exportRepository] = useState(() => new SupabaseDataExportRepository());
  const [state, setState] = useState<LedgerState>({ clients: [], receivables: [], promises: [], payments: [], activities: [] });
  const [selectedReceivableId, setSelectedReceivableId] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [sheet, setSheet] = useState<"client" | "receivable" | "promise" | "payment" | "followup" | "snooze" | "upgrade" | "edit-client" | "edit-receivable" | "edit-profile" | "close-receivable" | "withdraw-promise" | null>(null);
  const [saving, setSaving] = useState(false);
  // Which export, if any, is currently being built. Reads are cheap but a download
  // button pressed twice should not produce two files.
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  // One in-flight write at a time: while a save is on the wire the buttons are
  // disabled and a second submit is refused here, so the same money cannot be
  // sent twice from two rapid clicks. The database keeps its own guard too.
  const savingRef = useRef(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => (localStorage.getItem("dueweave-theme") as "light" | "dark") || "light");
  const [selectedFilter, setSelectedFilter] = useState<ReceivableStatusFilter>("open");
  const [receivableQuery, setReceivableQuery] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [profileError, setProfileError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [staleError, setStaleError] = useState("");
  // Set once a read has actually reached the screen. From then on every read is a
  // background refresh: blanking a workspace someone has just edited reads like the
  // edit deleted it, so the screen stays and the numbers change in place.
  const hasLoadedRef = useRef(false);
  const [founderLimitReached, setFounderLimitReached] = useState(false);

  useEffect(() => { localStorage.setItem("dueweave-theme", theme); }, [theme]);
  const refresh = useCallback(async () => {
    const background = hasLoadedRef.current;
    if (background) setRefreshing(true); else setLoading(true);
    setLoadError("");
    try {
      await dashboardRepository.settleDuePromises();
      const next = await dashboardRepository.read();
      setState(next);
      hasLoadedRef.current = true;
      setSelectedReceivableId((current) => next.receivables.some((item) => item.id === current) ? current : next.receivables[0]?.id ?? "");
      setSelectedClientId((current) => next.clients.some((item) => item.id === current) ? current : next.clients[0]?.id ?? "");
      setStaleError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "We could not open your private ledger. Please try again.";
      if (background) setStaleError(message); else setLoadError(message);
    } finally {
      if (background) setRefreshing(false); else setLoading(false);
    }
  }, [dashboardRepository]);
  useEffect(() => { void refresh(); }, [refresh]);
  const selectedReceivable = state.receivables.find((item) => item.id === selectedReceivableId) ?? state.receivables[0];
  const selectedClient = selectedReceivable ? getClient(selectedReceivable.clientId, state.clients) : state.clients[0];
  const editingClient = state.clients.find((item) => item.id === selectedClientId) ?? state.clients[0];
  const queue = useMemo(() => getQueue(state), [state]);
  const openReceivables = state.receivables.filter((item) => getOutstanding(item) > 0);
  const outside = openReceivables.reduce((sum, item) => sum + getOutstanding(item), 0);
  const today = todayInIndia();
  const displayName = profile?.displayName.trim() || "Your name";
  const workspaceName = profile?.businessName.trim() || "Private workspace";
  const email = user?.email ?? "";
  const recoveredThisMonth = state.payments.filter((payment) => payment.paidDate.startsWith(today.slice(0, 7))).reduce((sum, payment) => sum + payment.amountPaise, 0);
  const expectedThisWeek = state.promises.filter((promise) => promise.status === "ACTIVE" && daysBetween(today, promise.promisedDate) >= 0 && daysBetween(today, promise.promisedDate) <= 7).reduce((sum, promise) => sum + promise.promisedAmountPaise, 0);
  const latestActivePromise = selectedReceivable ? getPromisesFor(selectedReceivable.id, state.promises).filter((promise) => promise.status === "ACTIVE").at(-1) : undefined;
  const receivedOnSelected = selectedReceivable ? Math.max(0, selectedReceivable.amountDuePaise - getOutstanding(selectedReceivable)) : 0;
  const brokenCount = state.promises.filter((promise) => promise.status === "BROKEN").length;
  function navigate(next: AppSection) { setActive(next); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openSheet(kind: typeof sheet, id = selectedReceivableId) { setSelectedReceivableId(id); setSheet(kind); }
  function beginWrite() { if (savingRef.current) return false; savingRef.current = true; setSaving(true); return true; }
  function endWrite() { savingRef.current = false; setSaving(false); }

  async function addClient(input: { name: string; company: string; phone: string; email: string; notes: string }) {
    if (!beginWrite()) return;
    try {
      const created = await clientRepository.create(input);
      await refresh(); setSelectedClientId(created.id); setSheet(null); navigate("clients"); feedback.success("Client added", { description: "Add a receivable when an invoice is ready." });
    } catch (error) { feedback.error("Could not add client", { description: error instanceof Error ? error.message : "Please try again." }); }
    finally { endWrite(); }
  }

  // An edit sends the row's own concurrency token, so a record that moved on
  // while this form was open is refused instead of silently overwritten.
  async function saveClientDetails(input: { name: string; company: string; phone: string; email: string; notes: string }) {
    if (!editingClient || !beginWrite()) return;
    try {
      await clientRepository.update({ ...input, id: editingClient.id, expectedUpdatedAt: editingClient.updatedAt });
      await refresh(); setSheet(null); feedback.success("Client updated", { description: "Only the wording changed. Amounts and history are untouched." });
    } catch (error) {
      feedback.error("Could not update client", { description: error instanceof Error ? error.message : "Please try again." });
    } finally { endWrite(); }
  }

  async function saveReceivableDetails(input: { label: string; invoiceRef: string; notes: string }) {
    if (!selectedReceivable || !beginWrite()) return;
    try {
      await receivableRepository.updateDetails({ ...input, id: selectedReceivable.id, expectedUpdatedAt: selectedReceivable.updatedAt });
      await refresh(); setSheet(null); feedback.success("Details updated", { description: "The amount, due date, and history are exactly as they were." });
    } catch (error) {
      feedback.error("Could not update details", { description: error instanceof Error ? error.message : "Please try again." });
    } finally { endWrite(); }
  }

  async function addReceivable(input: ReceivableSubmitInput) {
    if (!beginWrite()) return;
    try {
      const created = input.mode === "existing"
        ? await receivableRepository.createForClient({ clientId: input.clientId, label: input.receivableLabel || input.invoiceRef || "Client work", invoiceRef: input.invoiceRef, amountPaise: input.amountPaise, dueDate: input.dueDate, notes: input.notes })
        : await receivableRepository.createWithClient(input);
      await refresh(); setSelectedReceivableId(created.id); setSelectedClientId(created.clientId); setSheet(null); navigate("today"); feedback.success("Receivable added", { description: "It is now part of your Today queue." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      if (message.includes("Free plan allows up to three active receivables")) {
        setFounderLimitReached(true); setSheet(null);
        feedback.error("Your Free plan limit is reached.", { description: "Founder access removes the active-receivable limit after manual approval.", action: { label: "View Founder", onClick: () => navigateTo("/founder") } });
        return;
      }
      feedback.error("Could not add receivable", { description: message });
    } finally { endWrite(); }
  }

  async function addPromise(input: PromiseSubmitInput) {
    if (!selectedReceivable || !beginWrite()) return;
    try {
      await promiseRepository.create({ receivableId: selectedReceivable.id, amountPaise: input.amountPaise, madeOn: input.madeOn, promisedDate: input.promisedDate, source: input.source, note: input.note, requestId: input.requestId });
      await refresh(); setSheet(null); feedback.success("Promise added", { description: "The previous commitment remains in the timeline." });
    } catch (error) {
      feedback.error("Could not record promise", { description: error instanceof Error ? error.message : "Please try again." });
    } finally { endWrite(); }
  }

  async function recordPayment(input: PaymentSubmitInput) {
    if (!selectedReceivable || !beginWrite()) return;
    try {
      await paymentRepository.record({ receivableId: selectedReceivable.id, amountPaise: input.amountPaise, paidOn: input.paidDate, method: input.method, reference: input.reference, requestId: input.requestId });
      await refresh(); setSheet(null); feedback.success("Payment recorded", { description: "Your receivable and promise history are now up to date." });
    } catch (error) {
      feedback.error("Could not record payment", { description: error instanceof Error ? error.message : "Please try again." });
    } finally { endWrite(); }
  }

  // Closing is offered only while nothing has been received; the database
  // refuses the same thing again, so a stale browser cannot force it.
  async function closeReceivable(reason: string) {
    if (!selectedReceivable || !beginWrite()) return;
    try {
      await receivableRepository.cancel(selectedReceivable.id, reason);
      await refresh(); setSheet(null); feedback.success("Receivable closed", { description: "The amount and its promise history stay in the timeline. Nothing was deleted." });
    } catch (error) {
      feedback.error("Could not close receivable", { description: error instanceof Error ? error.message : "Please try again." });
    } finally { endWrite(); }
  }

  async function withdrawPromise(promiseId: string, reason: string) {
    if (!beginWrite()) return;
    try {
      await promiseRepository.cancel(promiseId, reason);
      await refresh(); setSheet(null); feedback.success("Promise withdrawn", { description: "The withdrawal is on the timeline. Nothing was deleted." });
    } catch (error) {
      feedback.error("Could not withdraw promise", { description: error instanceof Error ? error.message : "Please try again." });
    } finally { endWrite(); }
  }

  // Only a confirmation made here, inside DueWeave, becomes a touchpoint. Opening a
  // WhatsApp tab or copying the message proves nothing about what happened next.
  async function markContacted(note: string) {
    if (!selectedReceivable || !beginWrite()) return;
    try { await activityRepository.recordContacted(selectedReceivable.id, note); await refresh(); setSheet(null); feedback.success("Follow-up marked", { description: "The queue will remember this touchpoint." }); }
    catch (error) { feedback.error("Could not record follow-up", { description: error instanceof Error ? error.message : "Please try again." }); }
    finally { endWrite(); }
  }

  async function snooze(until: string) {
    if (!selectedReceivable || !beginWrite()) return;
    try { await activityRepository.snooze(selectedReceivable.id, until); await refresh(); setSheet(null); feedback.success("Follow-up snoozed", { description: `It will return on ${formatDate(until)}.` }); }
    catch (error) { feedback.error("Could not snooze follow-up", { description: error instanceof Error ? error.message : "Please try again." }); }
    finally { endWrite(); }
  }

  async function handleSignOut() { const result = await signOut(); if (result.error) feedback.error("Could not sign out", { description: result.error }); }

  // The profile edit keeps its own error rather than only a toast: the sheet stays
  // open with what was typed, and the reason is written where the fields are.
  async function saveProfile(input: { displayName: string; businessName: string }) {
    if (!beginWrite()) return;
    try {
      await saveWorkspace(input);
      await reload();
      setProfileError("");
      setSheet(null);
      feedback.success("Workspace details saved", { description: "Your name and business name are stored with your account, not this device." });
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "We could not save your workspace details. Please try again.");
    } finally { endWrite(); }
  }

  async function sendRecoveryLink() {
    const result = await resetPassword(user?.email ?? "");
    if (result.error) feedback.error("Could not send the reset link", { description: result.error });
    else feedback.success("Reset link sent", { description: "Open it in this browser to choose a new password." });
  }

  // An export is a read followed by a local file: nothing here writes, and the
  // browser is only ever asked to start a download. "Started" rather than
  // "downloaded" is the honest claim, because no web API reports where the
  // file landed.
  async function downloadData(kind: ExportKind) {
    if (exporting) return;
    setExporting(kind);
    try {
      const snapshot = await exportRepository.read();
      const contents = kind === "data"
        ? serializeExportBundle(buildExportBundle(snapshot, new Date().toISOString()))
        : withByteOrderMark(csvFor(kind, snapshot));
      downloadGeneratedFile(exportFilename(kind, todayInIndia()), kind === "data" ? EXPORT_JSON_MIME : EXPORT_CSV_MIME, contents);
      feedback.success("Download started", { description: "Look in your browser's downloads for it." });
    } catch (error) {
      feedback.error("Could not prepare the file", { description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setExporting(null);
    }
  }

  if (loading) return <div className={`app-shell ${theme === "dark" ? "app-shell--dark" : ""}`}><LoadingState /></div>;
  if (loadError) return <div className={`app-shell ${theme === "dark" ? "app-shell--dark" : ""}`}><ErrorState onRetry={() => { void refresh(); }} /></div>;
  if (!state.receivables.length && active === "today") return <div className={`app-shell ${theme === "dark" ? "app-shell--dark" : ""}`}><AppRail active={active} onNavigate={navigate} openCount={0} userName={displayName} workspaceName={workspaceName} /><div className="app-frame"><PageHeader section="today" onAdd={() => openSheet("receivable")} onToggleTheme={() => setTheme((current) => current === "light" ? "dark" : "light")} theme={theme} /><main className="app-content" aria-busy={refreshing}>{founderLimitReached && <FounderLimitCallout onFounder={() => navigateTo("/founder")} onDismiss={() => setFounderLimitReached(false)} />}{staleError && <StaleReadNote onRetry={() => { void refresh(); }} />}<EmptyStateCard onAdd={() => openSheet("receivable")} savedClients={state.clients.length} /><div className="empty-state-actions"><button className="button-secondary" onClick={() => openSheet("client")}>{state.clients.length ? "Add another client" : "Add a client first"}</button></div></main></div><BottomNav active={active} onNavigate={navigate} />{sheet === "client" && <AddClientSheet busy={saving} onClose={() => setSheet(null)} onSubmit={addClient} />}{sheet === "receivable" && <AddReceivableSheet clients={state.clients} busy={saving} onClose={() => setSheet(null)} onSubmit={addReceivable} />}</div>;

  return <div className={`app-shell ${theme === "dark" ? "app-shell--dark" : ""}`}><AppRail active={active} onNavigate={navigate} openCount={queue.length} userName={displayName} workspaceName={workspaceName} /><div className="app-frame"><PageHeader section={active} onAdd={() => openSheet("receivable")} onToggleTheme={() => setTheme((current) => current === "light" ? "dark" : "light")} theme={theme} /><main className="app-content" aria-busy={refreshing}>{founderLimitReached && <FounderLimitCallout onFounder={() => navigateTo("/founder")} onDismiss={() => setFounderLimitReached(false)} />}{staleError && <StaleReadNote onRetry={() => { void refresh(); }} />}{active === "today" && selectedReceivable && <TodayView userName={displayName} state={state} queue={queue} outside={outside} recoveredThisMonth={recoveredThisMonth} expectedThisWeek={expectedThisWeek} brokenCount={brokenCount} selectedReceivable={selectedReceivable} selectedClient={selectedClient} selectedId={selectedReceivableId} onSelect={setSelectedReceivableId} onFollowUp={(id) => openSheet("followup", id)} onSnooze={(id) => openSheet("snooze", id)} onAddPromise={() => openSheet("promise")} onPayment={() => openSheet("payment")} onOpenClient={(id) => { setSelectedClientId(id); navigate("clients"); }} onEditDetails={() => openSheet("edit-receivable")} onCloseReceivable={() => openSheet("close-receivable")} onWithdrawPromise={() => openSheet("withdraw-promise")} canWithdrawPromise={Boolean(latestActivePromise)} onExplain={() => feedback.info("Priority is deterministic", { description: "Broken promises, urgency, overdue days, outstanding amount, staleness, and recent partial payments are scored — no AI is deciding for you." })} />}{active === "receivables" && <ReceivablesView state={state} filter={selectedFilter} onFilter={setSelectedFilter} query={receivableQuery} onQuery={setReceivableQuery} onSelect={(id) => { setSelectedReceivableId(id); navigate("today"); }} onAdd={() => openSheet("receivable")} />}{active === "clients" && <ClientsView state={state} selectedClientId={selectedClientId} query={clientQuery} onQuery={setClientQuery} onSelect={setSelectedClientId} onOpenReceivable={(id) => { setSelectedReceivableId(id); navigate("today"); }} onAddClient={() => openSheet("client")} onEditClient={(id) => { setSelectedClientId(id); setSheet("edit-client"); }} />}{active === "more" && <MoreView displayName={displayName} workspaceName={workspaceName} email={email} theme={theme} onToggleTheme={() => setTheme((current) => current === "light" ? "dark" : "light")} onSignOut={() => { void handleSignOut(); }} onEditProfile={() => { setProfileError(""); setSheet("edit-profile"); }} onRecovery={() => { void sendRecoveryLink(); }} exporting={exporting} onDownload={downloadData} onFounder={() => navigateTo("/founder")} />}{active === "empty" && <EmptyStateCard onAdd={() => openSheet("receivable")} />}{active === "loading" && <LoadingState />}{active === "error" && <ErrorState onRetry={() => { void refresh(); }} />}</main></div><button className="floating-add" onClick={() => openSheet("receivable")} aria-label="Add receivable"><Plus size={22} /></button><BottomNav active={active} onNavigate={navigate} />{sheet === "client" && <AddClientSheet busy={saving} onClose={() => setSheet(null)} onSubmit={addClient} />}{sheet === "receivable" && <AddReceivableSheet clients={state.clients} busy={saving} onClose={() => setSheet(null)} onSubmit={addReceivable} />}{sheet === "promise" && selectedReceivable && <AddPromiseSheet receivable={selectedReceivable} client={selectedClient} busy={saving} onClose={() => setSheet(null)} onSubmit={addPromise} />}{sheet === "payment" && selectedReceivable && <PaymentSheet receivable={selectedReceivable} busy={saving} onClose={() => setSheet(null)} onSubmit={recordPayment} />}{sheet === "followup" && selectedReceivable && selectedClient && <FollowUpSheet receivable={selectedReceivable} client={selectedClient} state={state} onClose={() => setSheet(null)} onConfirmContact={(note) => { void markContacted(note); }} />}{sheet === "snooze" && selectedReceivable && <SnoozeSheet onClose={() => setSheet(null)} onSubmit={snooze} />}{sheet === "close-receivable" && selectedReceivable && <CloseReceivableSheet receivable={selectedReceivable} client={getClient(selectedReceivable.clientId, state.clients)} paidPaise={receivedOnSelected} busy={saving} onClose={() => setSheet(null)} onSubmit={closeReceivable} />}{sheet === "withdraw-promise" && latestActivePromise && <WithdrawPromiseSheet promise={latestActivePromise} client={selectedReceivable ? getClient(selectedReceivable.clientId, state.clients) : undefined} busy={saving} onClose={() => setSheet(null)} onSubmit={(reason) => { void withdrawPromise(latestActivePromise.id, reason); }} />}{sheet === "edit-client" && editingClient && <EditClientSheet client={editingClient} busy={saving} onClose={() => setSheet(null)} onSubmit={saveClientDetails} />}{sheet === "edit-profile" && profile && <EditProfileSheet displayName={profile.displayName} businessName={profile.businessName} email={email} busy={saving} saveError={profileError} onClose={() => setSheet(null)} onSubmit={(input) => { void saveProfile(input); }} />}{sheet === "edit-receivable" && selectedReceivable && <EditReceivableSheet receivable={selectedReceivable} client={getClient(selectedReceivable.clientId, state.clients)} busy={saving} onClose={() => setSheet(null)} onSubmit={saveReceivableDetails} />}</div>;
}

function FounderLimitCallout({ onFounder, onDismiss }: { onFounder: () => void; onDismiss: () => void }) {
  return <section className="founder-limit-callout" role="status"><div><span className="eyebrow">Free plan limit reached</span><strong>You have three active receivables.</strong><p>Settle or close one, or view Founder access. Founder access is activated only after manual payment review.</p></div><div><button type="button" className="button-primary" onClick={onFounder}>View Founder access <ArrowUpRight size={16} /></button><button type="button" className="text-button" onClick={onDismiss}>Dismiss</button></div></section>;
}

function StaleReadNote({ onRetry }: { onRetry: () => void }) {
  // The write itself already succeeded; only the read-back failed. The numbers on
  // screen stay visible and are labelled as the last version that loaded, rather
  // than the whole workspace being swapped for an error page.
  return <section className="ledger-note" role="status"><div><span className="eyebrow">Out of date</span><strong>This is the last version DueWeave could read.</strong><p>Nothing was lost and nothing was repeated. Load the latest copy to see the current amounts.</p></div><button type="button" className="button-secondary" onClick={onRetry}><RotateCw size={15} /> Load the latest</button></section>;
}

function TodayView({ userName, state, queue, outside, recoveredThisMonth, expectedThisWeek, brokenCount, selectedReceivable, selectedClient, selectedId, onSelect, onFollowUp, onSnooze, onAddPromise, onPayment, onOpenClient, onEditDetails, onCloseReceivable, onWithdrawPromise, canWithdrawPromise, onExplain }: { userName: string; state: LedgerState; queue: ReturnType<typeof getQueue>; outside: number; recoveredThisMonth: number; expectedThisWeek: number; brokenCount: number; selectedReceivable: Receivable; selectedClient?: ReturnType<typeof getClient>; selectedId: string; onSelect: (id: string) => void; onFollowUp: (id: string) => void; onSnooze: (id: string) => void; onAddPromise: () => void; onPayment: () => void; onOpenClient: (id: string) => void; onEditDetails: () => void; onCloseReceivable: () => void; onWithdrawPromise: () => void; canWithdrawPromise: boolean; onExplain: () => void }) {
  const attentionCount = queue.filter(({ receivable }) => priorityBreakdown(receivable, state).total >= 30).length;
  const openCount = state.receivables.filter((receivable) => getOutstanding(receivable) > 0).length;
  return <div className="today-layout"><section className="today-main"><div className="welcome-line"><div><span className="eyebrow">Good morning, {userName.split(" ")[0]}</span><h2 className="today-brief-heading">{attentionCount} follow-ups matter today.</h2></div><span className="today-note"><Sparkles size={14} /> {queue.length} open receivables</span></div><div className="money-hero"><img src={BRAND.texture} alt="" aria-hidden="true" /><div className="money-hero__copy"><span className="eyebrow">Still outstanding</span><strong>{formatINR(outside)}</strong><span>Across {queue.length} open client amounts</span><span className="money-hero__attention">{attentionCount} clients need attention today</span></div><div className="money-hero__side"><div className="mini-trend"><span className="trend-line" /><span>Steady view</span></div><button className="hero-link" onClick={onExplain}>How priority works <Filter size={14} /></button></div></div><div className="metric-grid"><Metric label="Recovered this month" value={formatINR(recoveredThisMonth)} accent="teal" sub="Across your private ledger" /><Metric label="Expected this week" value={formatINR(expectedThisWeek)} accent="amber" sub="From active promises" /><Metric label="Broken promises" value={String(brokenCount)} accent="coral" sub="Need a human decision" /></div><div className="section-heading"><div><span className="eyebrow">Today’s follow-ups</span><h2>Who needs attention now?</h2></div><button className="filter-button" onClick={onExplain}><Filter size={14} /> Explain queue</button></div><div className="queue-list">{queue.length === 0 ? <div className="all-clear" role="status"><CircleCheck size={20} /><div><span className="eyebrow">Nothing to chase today</span><h3>Nothing needs your attention today.</h3><p>{openCount > 0 ? `${openCount} ${openCount === 1 ? "receivable is" : "receivables are"} still open, each waiting quietly until the follow-up date you chose.` : "Nothing is outstanding. Settled and closed amounts stay in your timeline and in All history."}</p></div></div> : queue.map(({ receivable }) => { const client = getClient(receivable.clientId, state.clients)!; return <QueueCard key={receivable.id} receivable={receivable} client={client} state={state} selected={receivable.id === selectedId} onSelect={() => onSelect(receivable.id)} onFollowUp={() => onFollowUp(receivable.id)} />; })}</div></section><aside className="today-detail"><ReceivablePreview receivable={selectedReceivable} client={selectedClient} state={state} onFollowUp={() => onFollowUp(selectedReceivable.id)} onSnooze={() => onSnooze(selectedReceivable.id)} onAddPromise={onAddPromise} onPayment={onPayment} onOpenClient={() => selectedClient && onOpenClient(selectedClient.id)} onEditDetails={onEditDetails} onCloseReceivable={onCloseReceivable} onWithdrawPromise={onWithdrawPromise} canWithdrawPromise={canWithdrawPromise} /></aside></div>;
}

function ReceivablePreview({ receivable, client, state, onFollowUp, onSnooze, onAddPromise, onPayment, onOpenClient, onEditDetails, onCloseReceivable, onWithdrawPromise, canWithdrawPromise }: { receivable: Receivable; client?: ReturnType<typeof getClient>; state: LedgerState; onFollowUp: () => void; onSnooze: () => void; onAddPromise: () => void; onPayment: () => void; onOpenClient: () => void; onEditDetails: () => void; onCloseReceivable: () => void; onWithdrawPromise: () => void; canWithdrawPromise: boolean }) {
  const outstanding = getOutstanding(receivable);
  const receivedPaise = Math.max(0, receivable.amountDuePaise - outstanding);
  const latest = getLatestPromise(receivable.id, state.promises);
  const reasons = priorityReasons(receivable, state);
  const breakdown = priorityBreakdown(receivable, state);
  return <div className="detail-panel"><div className="detail-panel__top"><span className="eyebrow">Selected receivable</span><button className="icon-button" aria-label="Snooze follow-up" onClick={onSnooze}><CalendarDays size={18} /></button></div><div className="detail-client"><div className="client-avatar client-avatar--large">{client?.company.split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div><strong>{client?.company}</strong><span>{client?.name}</span></div><button className="text-button" onClick={onOpenClient}>Client view <ChevronRight size={14} /></button></div><div className="detail-amount"><span>Still outside</span><strong>{formatINR(outstanding)}</strong><span>{receivable.title} · due {formatDate(receivable.dueDate)}</span></div><div className="detail-priority"><div className="detail-priority__top"><span>Today priority</span><strong>{breakdown.total}</strong></div><div className="priority-bar"><span style={{ width: `${breakdown.total}%` }} /></div><div className="reason-stack">{reasons.map((reason) => <div className="reason-line" key={reason.label}><span>{reason.label}</span><small>{reason.value > 0 ? `+${reason.value}` : "quiet"}</small></div>)}</div></div>{latest && <div className={`promise-callout promise-callout--${latest.status.toLowerCase()}`}><div className="promise-callout__icon">{latest.status === "BROKEN" ? <Zap size={17} /> : <CalendarDays size={17} />}</div><div><span className="eyebrow">Latest commitment</span><strong>{getPromiseStatusLabel(latest.status)}</strong><p>{formatINR(latest.promisedAmountPaise)} promised by {formatDate(latest.promisedDate)} via {latest.source}.</p></div></div>}<div className="detail-actions"><button className="button-primary" onClick={onFollowUp}><MessageCircle size={16} />Follow up</button><button className="button-secondary" onClick={onPayment}><WalletCards size={16} />Record payment</button></div><button className="detail-secondary-action" onClick={onEditDetails}><Pencil size={15} />Edit details <span>Amount and date unchanged</span></button><button className="detail-secondary-action" onClick={onAddPromise}><Plus size={15} />Record new promise <span>Old history stays intact</span></button><button className="detail-secondary-action" onClick={onSnooze}><CalendarDays size={15} />Snooze follow-up <span>Keep it in the private timeline</span></button>{canWithdrawPromise && <button className="detail-secondary-action" onClick={onWithdrawPromise}><Undo2 size={15} />Withdraw active promise <span>It stays on the timeline</span></button>}{receivable.status !== "CANCELLED" && receivedPaise === 0 && <button className="detail-secondary-action" onClick={onCloseReceivable}><Ban size={15} />Close this receivable <span>Only while nothing has been received</span></button>}<div className="detail-timeline"><div className="section-heading section-heading--compact"><div><span className="eyebrow">Activity</span><h3>What happened</h3></div><span className="timeline-count">{state.activities.filter((activity) => activity.receivableId === receivable.id).length} entries</span></div><Timeline receivable={receivable} state={state} /></div></div>;
}

const RECEIVABLE_FILTER_LABELS: Record<ReceivableStatusFilter, string> = { open: "Open", paid: "Paid", cancelled: "Cancelled", all: "All history" };

function ReceivablesView({ state, filter, onFilter, query, onQuery, onSelect, onAdd }: { state: LedgerState; filter: ReceivableStatusFilter; onFilter: (filter: ReceivableStatusFilter) => void; query: string; onQuery: (query: string) => void; onSelect: (id: string) => void; onAdd: () => void }) {
  const counts = countReceivablesByStatus(state.receivables);
  const items = selectReceivables(state, { filter, query });
  const searching = query.trim().length > 0;
  // A search that matched nothing, a filter holding nothing, and a ledger with no
  // records are three different situations; one message for all three would lie.
  const quietReason = searching
    ? `Nothing in ${RECEIVABLE_FILTER_LABELS[filter].toLowerCase()} matches “${query.trim()}”.`
    : filter === "cancelled" ? "Nothing has been closed. A closed amount stays here with the history it earned."
    : filter === "paid" ? "No amount has been settled in full yet."
    : filter === "open" ? "Nothing is outstanding. Every amount on record has been settled or closed."
    : "This ledger has no amounts on record yet.";
  return <div className="list-page"><div className="list-page__intro"><div><span className="eyebrow">The money you’re waiting for</span><h2>Receivables, without the accounting drag.</h2><p>Start after the invoice is already out. Keep the focus on what was promised next.</p></div><button className="button-primary" onClick={onAdd}><Plus size={16} />Add receivable</button></div><div className="list-page__tools"><div className="search-field"><label className="field__label" htmlFor="receivable-search">Search receivables</label><Search size={15} aria-hidden="true" /><input id="receivable-search" className="form-input" type="search" autoComplete="off" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Client, label, or invoice reference" /></div></div><div className="filter-tabs" role="tablist">{(["open", "paid", "cancelled", "all"] as const).map((item) => <button key={item} className={filter === item ? "filter-tab filter-tab--active" : "filter-tab"} onClick={() => onFilter(item)} role="tab" aria-selected={filter === item}>{RECEIVABLE_FILTER_LABELS[item]}<span>{counts[item]}</span></button>)}</div>{items.length === 0 ? <div className="list-empty" role="status"><SearchX size={19} /><div><h3>No matches in this view.</h3><p>{quietReason}</p></div>{searching ? <button className="button-secondary" onClick={() => onQuery("")}><SearchX size={15} />Clear search</button> : filter !== "all" ? <button className="button-secondary" onClick={() => onFilter("all")}><RotateCw size={15} />Show all history</button> : <button className="button-secondary" onClick={onAdd}><Plus size={15} />Add receivable</button>}</div> : <div className="receivables-grid">{items.map((receivable) => { const client = getClient(receivable.clientId, state.clients)!; const outstanding = getOutstanding(receivable); const latest = getLatestPromise(receivable.id, state.promises); return <button className="receivable-list-card" key={receivable.id} onClick={() => onSelect(receivable.id)}><div className="receivable-list-card__header"><div className="client-avatar">{client.company.split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div><strong>{client.company}</strong><span>{client.name}</span></div><StatusPill status={receivable.status} /></div><div className="receivable-list-card__title"><span>{receivable.title}</span><strong>{formatINR(outstanding)}</strong></div><div className="receivable-list-card__footer"><span>Due {formatDate(receivable.dueDate)}</span>{latest && <span className={`list-promise-dot list-promise-dot--${latest.status.toLowerCase()}`}>{getPromiseStatusLabel(latest.status)}</span>}<ChevronRight size={15} /></div></button>; })}</div>}</div>;
}

function ClientsView({ state, selectedClientId, onSelect, onOpenReceivable, onAddClient, onEditClient, query, onQuery }: { state: LedgerState; selectedClientId: string; onSelect: (id: string) => void; onOpenReceivable: (id: string) => void; onAddClient: () => void; onEditClient: (id: string) => void; query: string; onQuery: (query: string) => void }) {
  const visible = selectClients(state.clients, query);
  // Only a client the current search actually allows can be shown in the detail
  // panel, so the list and the panel can never disagree about what is on screen.
  const client = visible.find((item) => item.id === selectedClientId) ?? visible[0];
  const intro = <div className="list-page__intro"><div><span className="eyebrow">People behind the amounts</span><h2>Clients</h2><p>{state.clients.length ? "Facts, not labels. A clearer history for the next conversation." : "Start with the person, then add the first receivable when it is ready."}</p></div><button className="button-primary" onClick={onAddClient}><Plus size={16} />Add client</button></div>;
  const tools = <div className="list-page__tools"><div className="search-field"><label className="field__label" htmlFor="client-search">Search clients</label><Search size={15} aria-hidden="true" /><input id="client-search" className="form-input" type="search" autoComplete="off" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Name, company, email, or phone" /></div></div>;
  const noMatch = <div className="list-empty" role="status"><SearchX size={19} /><div><h3>No client matches that search.</h3><p>Nothing named “{query.trim()}” is in this ledger. Everyone saved here is still there.</p></div><button className="button-secondary" onClick={() => onQuery("")}><SearchX size={15} />Clear search</button></div>;
  if (!client) return <div className="list-page">{intro}{state.clients.length ? <>{tools}{noMatch}</> : null}</div>;
  const clientReceivables = state.receivables.filter((item) => item.clientId === client.id);
  const clientOutstanding = clientReceivables.reduce((sum, item) => sum + getOutstanding(item), 0);
  const resolvedCount = state.promises.filter((promise) => clientReceivables.some((item) => item.id === promise.receivableId) && promise.status !== "ACTIVE").length;
  return <div className="clients-layout"><section className="clients-list"><div className="list-page__intro"><div><span className="eyebrow">People behind the amounts</span><h2>Clients</h2><p>Facts, not labels. A clearer history for the next conversation.</p></div><button className="button-secondary" onClick={onAddClient}><Plus size={16} />Add client</button></div>{tools}<div className="client-list">{visible.map((item) => { const outstanding = state.receivables.filter((r) => r.clientId === item.id).reduce((sum, r) => sum + getOutstanding(r), 0); return <button key={item.id} className={item.id === client.id ? "client-row client-row--active" : "client-row"} onClick={() => onSelect(item.id)}><div className="client-avatar">{item.company.split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div className="client-row__info"><strong>{item.company || item.name}</strong><span>{item.name}</span></div><div className="client-row__amount"><strong>{outstanding ? formatINR(outstanding) : "Paid"}</strong><span>{getPromisesFor(state.receivables.find((r) => r.clientId === item.id)?.id ?? "", state.promises).length ? "Promise history" : "New relationship"}</span></div><ChevronRight size={15} /></button>; })}</div></section><section className="client-detail-panel"><div className="client-profile-heading"><div className="client-avatar client-avatar--xl">{(client.company || client.name).split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div><span className="eyebrow">Client story</span><h2>{client.name}</h2><p>{client.company || "Independent client"}{client.email ? ` · ${client.email}` : ""}</p></div><button className="button-secondary" onClick={() => onEditClient(client.id)}><Pencil size={15} />Edit client</button></div><div className="client-stat-grid"><Metric label="Outstanding" value={formatINR(clientOutstanding)} accent={clientOutstanding ? "coral" : "teal"} /><Metric label="Recovered historically" value={formatINR(state.payments.filter((p) => clientReceivables.some((r) => r.id === p.receivableId)).reduce((sum, p) => sum + p.amountPaise, 0))} accent="teal" /><Metric label="Promises" value={String(state.promises.filter((p) => clientReceivables.some((r) => r.id === p.receivableId)).length)} /></div><Reliability clientId={client.id} state={state} /><div className="client-history"><div className="section-heading section-heading--compact"><div><span className="eyebrow">Open work</span><h3>Receivable story</h3></div><span className="timeline-count">{resolvedCount} resolved promises</span></div>{clientReceivables.map((receivable) => <button className="client-receivable" key={receivable.id} onClick={() => onOpenReceivable(receivable.id)}><div><strong>{receivable.title}</strong><span>Due {formatDate(receivable.dueDate)} · {getLatestPromise(receivable.id, state.promises) ? getPromiseStatusLabel(getLatestPromise(receivable.id, state.promises)!.status) : "No promise yet"}</span></div><strong>{formatINR(getOutstanding(receivable))}</strong><ChevronRight size={15} /></button>)}</div></section></div>;
}

// Stage 7 hands the ledger back as files. The archive is the complete copy; the
// CSVs are convenience views a spreadsheet can open without a converter.
const spreadsheetExports: { kind: Exclude<ExportKind, "data">; label: string }[] = [
  { kind: "clients", label: "Clients" },
  { kind: "receivables", label: "Receivables" },
  { kind: "payments", label: "Payments" },
  { kind: "promises", label: "Promises" },
  { kind: "activities", label: "Activity" },
];

function MoreView({ displayName, workspaceName, email, theme, exporting, onToggleTheme, onSignOut, onEditProfile, onRecovery, onDownload, onFounder }: { displayName: string; workspaceName: string; email: string; theme: "light" | "dark"; exporting: ExportKind | null; onToggleTheme: () => void; onSignOut: () => void; onEditProfile: () => void; onRecovery: () => void; onDownload: (kind: ExportKind) => void; onFounder: () => void }) {
  return <div className="more-page"><div className="more-hero"><div><span className="eyebrow">More control, less noise</span><h2>A private ledger for the awkward middle.</h2><p>Your client and receivable records are protected by authenticated, row-level security. Messages and payments are never sent automatically.</p></div><img src={BRAND.promiseIllustration} alt="Abstract hands passing a promise note" /></div><div className="settings-grid"><section className="settings-panel settings-panel--identity"><div className="settings-panel__header"><div><span className="eyebrow">Your workspace</span><h3>Who this ledger belongs to.</h3></div><User size={18} /></div><div className="identity-list"><div className="identity-row"><span className="identity-row__label">Your name</span><strong>{displayName}</strong></div><div className="identity-row"><span className="identity-row__label">Business or workspace</span><strong>{workspaceName}</strong></div><div className="identity-row"><span className="identity-row__label">Currency</span><strong>Indian rupee · INR</strong></div><div className="identity-row"><span className="identity-row__label">Business calendar</span><strong>India · Asia/Kolkata</strong></div></div><button className="settings-row" onClick={onEditProfile}><div className="settings-icon"><Pencil size={16} /></div><div><strong>Edit your name and workspace name</strong><span>Saved with your account, shown only to you.</span></div><span className="settings-value">Change</span></button></section><section className="settings-panel"><div className="settings-panel__header"><div><span className="eyebrow">Account</span><h3>Getting in, and getting back in.</h3></div><KeyRound size={18} /></div><div className="identity-list"><div className="identity-row"><span className="identity-row__label">Sign-in email</span><strong>{email}</strong></div></div><button className="settings-row" onClick={onRecovery}><div className="settings-icon"><RotateCw size={16} /></div><div><strong>Password</strong><span>We email a private link so you can choose a new one.</span></div><span className="settings-value">Send link</span></button><button className="settings-row" onClick={onSignOut}><div className="settings-icon"><ArrowUpRight size={16} /></div><div><strong>Sign out</strong><span>Return to the secure sign-in screen on this device.</span></div><ChevronRight size={16} /></button></section><section className="settings-panel"><div className="settings-panel__header"><div><span className="eyebrow">Preferences</span><h3>Make it feel like yours.</h3></div><Settings2 size={18} /></div><button className="settings-row" onClick={onToggleTheme}><div className="settings-icon">{theme === "light" ? <Sun size={16} /> : <Moon size={16} />}</div><div><strong>{theme === "light" ? "Light mode" : "Dark mode"}</strong><span>Saved locally on this device.</span></div><span className="settings-value">Change</span></button><div className="settings-row settings-row--static"><div className="settings-icon"><ShieldCheck size={16} /></div><div><strong>Private workspace</strong><span>Records are isolated by authenticated ownership.</span></div><span className="status-dot" /></div><div className="settings-row settings-row--static"><div className="settings-icon"><WalletCards size={16} /></div><div><strong>Currency</strong><span>Indian rupee · ₹</span></div><span className="settings-value">INR</span></div></section><section className="settings-panel"><div className="settings-panel__header"><div><span className="eyebrow">Founder Lifetime</span><h3>Expand when you need it.</h3></div><Sparkles size={18} /></div><button className="settings-row" onClick={onFounder}><div className="settings-icon"><Sparkles size={16} /></div><div><strong>Founder access</strong><span>One-time {formatINR(FOUNDER_PRICE_PAISE)} manual UPI verification. No payment credential is stored.</span></div><ChevronRight size={16} /></button></section><section className="settings-panel" role="region" aria-labelledby="your-data-heading"><div className="settings-panel__header"><div><span className="eyebrow">Your data</span><h3 id="your-data-heading">Take the ledger with you.</h3></div><Download size={18} /></div><button className="settings-row" onClick={() => onDownload("data")} disabled={exporting !== null}><div className="settings-icon"><Download size={16} /></div><div><strong>{exporting === "data" ? "Preparing the full archive…" : "Full data archive"}</strong><span>Every client, receivable, promise, payment and history row your account holds, as one versioned file.</span></div><span className="settings-value">Download JSON</span></button><p className="export-note">This file contains client names, contact details, receivables, payments and promise history. Anyone with the file can read it. It is a plain local file — DueWeave does not encrypt it.</p><div className="settings-row settings-row--static"><div className="settings-icon"><Download size={16} /></div><div><strong>Spreadsheet exports</strong><span>One file per list, for Excel, Numbers or Sheets.</span></div></div><div className="export-chips">{spreadsheetExports.map((item) => <button key={item.kind} className="export-chip" onClick={() => onDownload(item.kind)} disabled={exporting !== null}>{exporting === item.kind ? `Preparing ${item.label.toLowerCase()}…` : `${item.label} CSV`}</button>)}</div><p className="export-note">Reading a file back into DueWeave and deleting your account are not part of this build.</p></section></div><div className="prototype-footnote"><LockKeyhole size={15} /><span>Founder access is activated only after manual review against business bank history. UPI PINs, OTPs, passwords, and bank credentials are never requested.</span></div></div>;
}

export default App;
