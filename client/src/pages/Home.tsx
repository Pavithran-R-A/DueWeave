// Quiet Ledger style reminder: Today is the operational briefing; every other screen supports the path from promise to recovered money.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowUpRight, CalendarDays, ChevronRight, Filter, LockKeyhole, MessageCircle, Moon, Plus, Settings2, ShieldCheck, Sparkles, Sun, WalletCards, Zap } from "lucide-react";
import { toast } from "sonner";
import { BRAND } from "@/config/brand";
import { SupabaseActivityRepository } from "@/data/supabase-activity-repository";
import { SupabaseClientRepository } from "@/data/supabase-client-repository";
import { SupabaseDashboardRepository } from "@/data/supabase-dashboard-repository";
import { SupabasePaymentRepository } from "@/data/supabase-payment-repository";
import { SupabasePromiseRepository } from "@/data/supabase-promise-repository";
import { SupabaseReceivableRepository } from "@/data/supabase-receivable-repository";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { daysBetween, formatDate, formatINR, getClient, getLatestPromise, getOutstanding, getPromiseStatusLabel, getPromisesFor, getQueue, priorityBreakdown, priorityReasons, todayInIndia } from "@/lib/finance";
import type { AppSection, DemoState, PaymentMethod, PromiseSource, Receivable } from "@/types/domain";
import { AppRail, BottomNav, EmptyStateCard, ErrorState, LoadingState, Metric, PageHeader, QueueCard, Reliability, StatusPill, Timeline } from "@/components/finance-ui";
import { AddClientSheet, AddPromiseSheet, AddReceivableSheet, type ReceivableSubmitInput, FollowUpSheet, PaymentSheet, SnoozeSheet } from "@/components/sheets";

function App() {
  const { user, signOut } = useSupabaseAuth();
  const [, navigateTo] = useLocation();
  const [active, setActive] = useState<AppSection>("today");
  const [dashboardRepository] = useState(() => new SupabaseDashboardRepository());
  const [clientRepository] = useState(() => new SupabaseClientRepository());
  const [receivableRepository] = useState(() => new SupabaseReceivableRepository());
  const [promiseRepository] = useState(() => new SupabasePromiseRepository());
  const [paymentRepository] = useState(() => new SupabasePaymentRepository());
  const [activityRepository] = useState(() => new SupabaseActivityRepository());
  const [state, setState] = useState<DemoState>({ clients: [], receivables: [], promises: [], payments: [], activities: [] });
  const [selectedReceivableId, setSelectedReceivableId] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [sheet, setSheet] = useState<"client" | "receivable" | "promise" | "payment" | "followup" | "snooze" | "upgrade" | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => (localStorage.getItem("dueweave-theme") as "light" | "dark") || "light");
  const [selectedFilter, setSelectedFilter] = useState<"open" | "all" | "paid">("open");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [founderLimitReached, setFounderLimitReached] = useState(false);

  useEffect(() => { localStorage.setItem("dueweave-theme", theme); }, [theme]);
  const refresh = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const next = await dashboardRepository.read();
      setState(next);
      setSelectedReceivableId((current) => next.receivables.some((item) => item.id === current) ? current : next.receivables[0]?.id ?? "");
      setSelectedClientId((current) => next.clients.some((item) => item.id === current) ? current : next.clients[0]?.id ?? "");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "We could not open your private ledger. Please try again.");
    } finally { setLoading(false); }
  }, [dashboardRepository]);
  useEffect(() => { void refresh(); }, [refresh]);
  const selectedReceivable = state.receivables.find((item) => item.id === selectedReceivableId) ?? state.receivables[0];
  const selectedClient = selectedReceivable ? getClient(selectedReceivable.clientId, state.clients) : state.clients[0];
  const queue = useMemo(() => getQueue(state), [state]);
  const openReceivables = state.receivables.filter((item) => getOutstanding(item, state.payments) > 0);
  const outside = openReceivables.reduce((sum, item) => sum + getOutstanding(item, state.payments), 0);
  const today = todayInIndia();
  const userName = typeof user?.user_metadata.display_name === "string" && user.user_metadata.display_name.trim() ? user.user_metadata.display_name.trim() : user?.email?.split("@")[0] ?? "Your workspace";
  const recoveredThisMonth = state.payments.filter((payment) => payment.paidDate.startsWith(today.slice(0, 7))).reduce((sum, payment) => sum + payment.amountPaise, 0);
  const expectedThisWeek = state.promises.filter((promise) => promise.status === "ACTIVE" && daysBetween(today, promise.promisedDate) >= 0 && daysBetween(today, promise.promisedDate) <= 7).reduce((sum, promise) => sum + promise.promisedAmountPaise, 0);
  const brokenCount = state.promises.filter((promise) => promise.status === "BROKEN").length;
  function navigate(next: AppSection) { setActive(next); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openSheet(kind: typeof sheet, id = selectedReceivableId) { setSelectedReceivableId(id); setSheet(kind); }

  async function addClient(input: { name: string; company: string; phone: string; email: string; notes: string }) {
    try {
      const created = await clientRepository.create(input);
      await refresh(); setSelectedClientId(created.id); setSheet(null); navigate("clients"); toast.success("Client added", { description: "Add a receivable when an invoice is ready." });
    } catch (error) { toast.error("Could not add client", { description: error instanceof Error ? error.message : "Please try again." }); }
  }

  async function addReceivable(input: ReceivableSubmitInput) {
    try {
      const created = input.mode === "existing"
        ? await receivableRepository.createForClient({ clientId: input.clientId, label: input.receivableLabel || input.invoiceRef || "Client work", invoiceRef: input.invoiceRef, amountPaise: input.amountPaise, dueDate: input.dueDate, notes: input.notes })
        : await receivableRepository.createWithClient(input);
      await refresh(); setSelectedReceivableId(created.id); setSelectedClientId(created.clientId); setSheet(null); navigate("today"); toast.success("Receivable added", { description: "It is now part of your Today queue." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      if (message.includes("Free plan allows up to three active receivables")) {
        setFounderLimitReached(true); setSheet(null);
        toast.error("Your Free plan limit is reached.", { description: "Founder access removes the active-receivable limit after manual approval.", action: { label: "View Founder", onClick: () => navigateTo("/founder") } });
        return;
      }
      toast.error("Could not add receivable", { description: message });
    }
  }

  async function addPromise(input: { amountPaise: number; promisedDate: string; source: PromiseSource; note: string }) {
    if (!selectedReceivable) return;
    try { await promiseRepository.create(selectedReceivable.id, input.amountPaise, input.promisedDate, input.source, input.note); await refresh(); setSheet(null); toast.success("Promise added", { description: "The previous commitment remains in the timeline." }); }
    catch (error) { toast.error("Could not record promise", { description: error instanceof Error ? error.message : "Please try again." }); }
  }

  async function recordPayment(input: { amountPaise: number; paidDate: string; method: PaymentMethod; reference: string }) {
    if (!selectedReceivable) return;
    try { await paymentRepository.record(selectedReceivable.id, input.amountPaise, input.paidDate, input.method, input.reference); await refresh(); setSheet(null); toast.success("Payment recorded", { description: "Your receivable and promise history are now up to date." }); }
    catch (error) { toast.error("Could not record payment", { description: error instanceof Error ? error.message : "Please try again." }); }
  }

  async function markContacted() {
    if (!selectedReceivable) return;
    try { await activityRepository.recordContacted(selectedReceivable.id); await refresh(); setSheet(null); toast.success("Follow-up marked", { description: "The queue will remember this touchpoint." }); }
    catch (error) { toast.error("Could not record follow-up", { description: error instanceof Error ? error.message : "Please try again." }); }
  }

  async function snooze(until: string) {
    if (!selectedReceivable) return;
    try { await activityRepository.snooze(selectedReceivable.id, until); await refresh(); setSheet(null); toast.success("Follow-up snoozed", { description: `It will return on ${formatDate(until)}.` }); }
    catch (error) { toast.error("Could not snooze follow-up", { description: error instanceof Error ? error.message : "Please try again." }); }
  }

  async function handleSignOut() { const result = await signOut(); if (result.error) toast.error("Could not sign out", { description: result.error }); }

  if (loading) return <div className={`app-shell ${theme === "dark" ? "app-shell--dark" : ""}`}><LoadingState /></div>;
  if (loadError) return <div className={`app-shell ${theme === "dark" ? "app-shell--dark" : ""}`}><ErrorState onRetry={() => { void refresh(); }} /></div>;
  if (!state.receivables.length && active === "today") return <div className={`app-shell ${theme === "dark" ? "app-shell--dark" : ""}`}><AppRail active={active} onNavigate={navigate} openCount={0} userName={userName} /><div className="app-frame"><PageHeader section="today" onAdd={() => openSheet("receivable")} onToggleTheme={() => setTheme((current) => current === "light" ? "dark" : "light")} theme={theme} /><main className="app-content">{founderLimitReached && <FounderLimitCallout onFounder={() => navigateTo("/founder")} onDismiss={() => setFounderLimitReached(false)} />}<EmptyStateCard onAdd={() => openSheet("receivable")} /><div className="empty-state-actions"><button className="button-secondary" onClick={() => openSheet("client")}>Add a client first</button></div></main></div><BottomNav active={active} onNavigate={navigate} />{sheet === "client" && <AddClientSheet onClose={() => setSheet(null)} onSubmit={addClient} />}{sheet === "receivable" && <AddReceivableSheet clients={state.clients} onClose={() => setSheet(null)} onSubmit={addReceivable} />}</div>;

  return <div className={`app-shell ${theme === "dark" ? "app-shell--dark" : ""}`}><AppRail active={active} onNavigate={navigate} openCount={queue.length} userName={userName} /><div className="app-frame"><PageHeader section={active} onAdd={() => openSheet("receivable")} onToggleTheme={() => setTheme((current) => current === "light" ? "dark" : "light")} theme={theme} /><main className="app-content">{founderLimitReached && <FounderLimitCallout onFounder={() => navigateTo("/founder")} onDismiss={() => setFounderLimitReached(false)} />}{active === "today" && selectedReceivable && <TodayView userName={userName} state={state} queue={queue} outside={outside} recoveredThisMonth={recoveredThisMonth} expectedThisWeek={expectedThisWeek} brokenCount={brokenCount} selectedReceivable={selectedReceivable} selectedClient={selectedClient} selectedId={selectedReceivableId} onSelect={setSelectedReceivableId} onFollowUp={(id) => openSheet("followup", id)} onSnooze={(id) => openSheet("snooze", id)} onAddPromise={() => openSheet("promise")} onPayment={() => openSheet("payment")} onOpenClient={(id) => { setSelectedClientId(id); navigate("clients"); }} onExplain={() => toast.info("Priority is deterministic", { description: "Broken promises, urgency, overdue days, outstanding amount, staleness, and recent partial payments are scored — no AI is deciding for you." })} />}{active === "receivables" && <ReceivablesView state={state} filter={selectedFilter} onFilter={setSelectedFilter} onSelect={(id) => { setSelectedReceivableId(id); navigate("today"); }} onAdd={() => openSheet("receivable")} />}{active === "clients" && <ClientsView state={state} selectedClientId={selectedClientId} onSelect={setSelectedClientId} onOpenReceivable={(id) => { setSelectedReceivableId(id); navigate("today"); }} onAddClient={() => openSheet("client")} />}{active === "more" && <MoreView theme={theme} onToggleTheme={() => setTheme((current) => current === "light" ? "dark" : "light")} onSignOut={() => { void handleSignOut(); }} onFounder={() => navigateTo("/founder")} />}{active === "empty" && <EmptyStateCard onAdd={() => openSheet("receivable")} />}{active === "loading" && <LoadingState />}{active === "error" && <ErrorState onRetry={() => { void refresh(); }} />}</main></div><button className="floating-add" onClick={() => openSheet("receivable")} aria-label="Add receivable"><Plus size={22} /></button><BottomNav active={active} onNavigate={navigate} />{sheet === "client" && <AddClientSheet onClose={() => setSheet(null)} onSubmit={addClient} />}{sheet === "receivable" && <AddReceivableSheet clients={state.clients} onClose={() => setSheet(null)} onSubmit={addReceivable} />}{sheet === "promise" && selectedReceivable && <AddPromiseSheet receivable={selectedReceivable} client={selectedClient} state={state} onClose={() => setSheet(null)} onSubmit={addPromise} />}{sheet === "payment" && selectedReceivable && <PaymentSheet receivable={selectedReceivable} state={state} onClose={() => setSheet(null)} onSubmit={recordPayment} />}{sheet === "followup" && selectedReceivable && selectedClient && <FollowUpSheet receivable={selectedReceivable} client={selectedClient} state={state} onClose={() => setSheet(null)} onMarkContacted={markContacted} />}{sheet === "snooze" && selectedReceivable && <SnoozeSheet onClose={() => setSheet(null)} onSubmit={snooze} />}</div>;
}

function FounderLimitCallout({ onFounder, onDismiss }: { onFounder: () => void; onDismiss: () => void }) {
  return <section className="founder-limit-callout" role="status"><div><span className="eyebrow">Free plan limit reached</span><strong>You have three active receivables.</strong><p>Settle or close one, or view Founder access. Founder access is activated only after manual payment review.</p></div><div><button type="button" className="button-primary" onClick={onFounder}>View Founder access <ArrowUpRight size={16} /></button><button type="button" className="text-button" onClick={onDismiss}>Dismiss</button></div></section>;
}

function TodayView({ userName, state, queue, outside, recoveredThisMonth, expectedThisWeek, brokenCount, selectedReceivable, selectedClient, selectedId, onSelect, onFollowUp, onSnooze, onAddPromise, onPayment, onOpenClient, onExplain }: { userName: string; state: DemoState; queue: ReturnType<typeof getQueue>; outside: number; recoveredThisMonth: number; expectedThisWeek: number; brokenCount: number; selectedReceivable: Receivable; selectedClient?: ReturnType<typeof getClient>; selectedId: string; onSelect: (id: string) => void; onFollowUp: (id: string) => void; onSnooze: (id: string) => void; onAddPromise: () => void; onPayment: () => void; onOpenClient: (id: string) => void; onExplain: () => void }) {
  const attentionCount = queue.filter(({ receivable }) => priorityBreakdown(receivable, state).total >= 30).length;
  return <div className="today-layout"><section className="today-main"><div className="welcome-line"><div><span className="eyebrow">Good morning, {userName.split(" ")[0]}</span><h2 className="today-brief-heading">{attentionCount} follow-ups matter today.</h2></div><span className="today-note"><Sparkles size={14} /> {queue.length} open receivables</span></div><div className="money-hero"><img src={BRAND.texture} alt="" aria-hidden="true" /><div className="money-hero__copy"><span className="eyebrow">Still outstanding</span><strong>{formatINR(outside)}</strong><span>Across {queue.length} open client amounts</span><span className="money-hero__attention">{attentionCount} clients need attention today</span></div><div className="money-hero__side"><div className="mini-trend"><span className="trend-line" /><span>Steady view</span></div><button className="hero-link" onClick={onExplain}>How priority works <Filter size={14} /></button></div></div><div className="metric-grid"><Metric label="Recovered this month" value={formatINR(recoveredThisMonth)} accent="teal" sub="Across your private ledger" /><Metric label="Expected this week" value={formatINR(expectedThisWeek)} accent="amber" sub="From active promises" /><Metric label="Broken promises" value={String(brokenCount)} accent="coral" sub="Need a human decision" /></div><div className="section-heading"><div><span className="eyebrow">Today’s follow-ups</span><h2>Who needs attention now?</h2></div><button className="filter-button" onClick={onExplain}><Filter size={14} /> Explain queue</button></div><div className="queue-list">{queue.map(({ receivable }) => { const client = getClient(receivable.clientId, state.clients)!; return <QueueCard key={receivable.id} receivable={receivable} client={client} state={state} selected={receivable.id === selectedId} onSelect={() => onSelect(receivable.id)} onFollowUp={() => onFollowUp(receivable.id)} />; })}</div></section><aside className="today-detail"><ReceivablePreview receivable={selectedReceivable} client={selectedClient} state={state} onFollowUp={() => onFollowUp(selectedReceivable.id)} onSnooze={() => onSnooze(selectedReceivable.id)} onAddPromise={onAddPromise} onPayment={onPayment} onOpenClient={() => selectedClient && onOpenClient(selectedClient.id)} /></aside></div>;
}

function ReceivablePreview({ receivable, client, state, onFollowUp, onSnooze, onAddPromise, onPayment, onOpenClient }: { receivable: Receivable; client?: ReturnType<typeof getClient>; state: DemoState; onFollowUp: () => void; onSnooze: () => void; onAddPromise: () => void; onPayment: () => void; onOpenClient: () => void }) {
  const outstanding = getOutstanding(receivable, state.payments);
  const latest = getLatestPromise(receivable.id, state.promises);
  const reasons = priorityReasons(receivable, state);
  const breakdown = priorityBreakdown(receivable, state);
  return <div className="detail-panel"><div className="detail-panel__top"><span className="eyebrow">Selected receivable</span><button className="icon-button" aria-label="Snooze follow-up" onClick={onSnooze}><CalendarDays size={18} /></button></div><div className="detail-client"><div className="client-avatar client-avatar--large">{client?.company.split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div><strong>{client?.company}</strong><span>{client?.name}</span></div><button className="text-button" onClick={onOpenClient}>Client view <ChevronRight size={14} /></button></div><div className="detail-amount"><span>Still outside</span><strong>{formatINR(outstanding)}</strong><span>{receivable.title} · due {formatDate(receivable.dueDate)}</span></div><div className="detail-priority"><div className="detail-priority__top"><span>Today priority</span><strong>{breakdown.total}</strong></div><div className="priority-bar"><span style={{ width: `${breakdown.total}%` }} /></div><div className="reason-stack">{reasons.map((reason) => <div className="reason-line" key={reason.label}><span>{reason.label}</span><small>{reason.value > 0 ? `+${reason.value}` : "quiet"}</small></div>)}</div></div>{latest && <div className={`promise-callout promise-callout--${latest.status.toLowerCase()}`}><div className="promise-callout__icon">{latest.status === "BROKEN" ? <Zap size={17} /> : <CalendarDays size={17} />}</div><div><span className="eyebrow">Latest commitment</span><strong>{getPromiseStatusLabel(latest.status)}</strong><p>{formatINR(latest.promisedAmountPaise)} promised by {formatDate(latest.promisedDate)} via {latest.source}.</p></div></div>}<div className="detail-actions"><button className="button-primary" onClick={onFollowUp}><MessageCircle size={16} />Follow up</button><button className="button-secondary" onClick={onPayment}><WalletCards size={16} />Record payment</button></div><button className="detail-secondary-action" onClick={onAddPromise}><Plus size={15} />Record new promise <span>Old history stays intact</span></button><button className="detail-secondary-action" onClick={onSnooze}><CalendarDays size={15} />Snooze follow-up <span>Keep it in the private timeline</span></button><div className="detail-timeline"><div className="section-heading section-heading--compact"><div><span className="eyebrow">Activity</span><h3>What happened</h3></div><span className="timeline-count">{state.activities.filter((activity) => activity.receivableId === receivable.id).length} entries</span></div><Timeline receivable={receivable} state={state} /></div></div>;
}

function ReceivablesView({ state, filter, onFilter, onSelect, onAdd }: { state: DemoState; filter: "open" | "all" | "paid"; onFilter: (filter: "open" | "all" | "paid") => void; onSelect: (id: string) => void; onAdd: () => void }) {
  const items = state.receivables.filter((item) => filter === "all" || (filter === "open" ? getOutstanding(item, state.payments) > 0 : getOutstanding(item, state.payments) === 0));
  return <div className="list-page"><div className="list-page__intro"><div><span className="eyebrow">The money you’re waiting for</span><h2>Receivables, without the accounting drag.</h2><p>Start after the invoice is already out. Keep the focus on what was promised next.</p></div><button className="button-primary" onClick={onAdd}><Plus size={16} />Add receivable</button></div><div className="filter-tabs" role="tablist">{(["open", "all", "paid"] as const).map((item) => <button key={item} className={filter === item ? "filter-tab filter-tab--active" : "filter-tab"} onClick={() => onFilter(item)} role="tab" aria-selected={filter === item}>{item === "open" ? "Open" : item === "all" ? "All history" : "Paid"}<span>{item === "open" ? state.receivables.filter((r) => getOutstanding(r, state.payments) > 0).length : item === "paid" ? state.receivables.filter((r) => getOutstanding(r, state.payments) === 0).length : state.receivables.length}</span></button>)}</div><div className="receivables-grid">{items.map((receivable) => { const client = getClient(receivable.clientId, state.clients)!; const outstanding = getOutstanding(receivable, state.payments); const latest = getLatestPromise(receivable.id, state.promises); return <button className="receivable-list-card" key={receivable.id} onClick={() => onSelect(receivable.id)}><div className="receivable-list-card__header"><div className="client-avatar">{client.company.split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div><strong>{client.company}</strong><span>{client.name}</span></div><StatusPill status={receivable.status} /></div><div className="receivable-list-card__title"><span>{receivable.title}</span><strong>{formatINR(outstanding)}</strong></div><div className="receivable-list-card__footer"><span>Due {formatDate(receivable.dueDate)}</span>{latest && <span className={`list-promise-dot list-promise-dot--${latest.status.toLowerCase()}`}>{getPromiseStatusLabel(latest.status)}</span>}<ChevronRight size={15} /></div></button>; })}</div></div>;
}

function ClientsView({ state, selectedClientId, onSelect, onOpenReceivable, onAddClient }: { state: DemoState; selectedClientId: string; onSelect: (id: string) => void; onOpenReceivable: (id: string) => void; onAddClient: () => void }) {
  const client = state.clients.find((item) => item.id === selectedClientId) ?? state.clients[0];
  if (!client) return <div className="list-page"><div className="list-page__intro"><div><span className="eyebrow">People behind the amounts</span><h2>Clients</h2><p>Start with the person, then add the first receivable when it is ready.</p></div><button className="button-primary" onClick={onAddClient}><Plus size={16} />Add client</button></div></div>;
  const clientReceivables = state.receivables.filter((item) => item.clientId === client.id);
  const clientOutstanding = clientReceivables.reduce((sum, item) => sum + getOutstanding(item, state.payments), 0);
  const resolvedCount = state.promises.filter((promise) => clientReceivables.some((item) => item.id === promise.receivableId) && promise.status !== "ACTIVE").length;
  return <div className="clients-layout"><section className="clients-list"><div className="list-page__intro"><div><span className="eyebrow">People behind the amounts</span><h2>Clients</h2><p>Facts, not labels. A clearer history for the next conversation.</p></div><button className="button-secondary" onClick={onAddClient}><Plus size={16} />Add client</button></div><div className="client-list">{state.clients.map((item) => { const outstanding = state.receivables.filter((r) => r.clientId === item.id).reduce((sum, r) => sum + getOutstanding(r, state.payments), 0); return <button key={item.id} className={item.id === client.id ? "client-row client-row--active" : "client-row"} onClick={() => onSelect(item.id)}><div className="client-avatar">{item.company.split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div className="client-row__info"><strong>{item.company || item.name}</strong><span>{item.name}</span></div><div className="client-row__amount"><strong>{outstanding ? formatINR(outstanding) : "Paid"}</strong><span>{getPromisesFor(state.receivables.find((r) => r.clientId === item.id)?.id ?? "", state.promises).length ? "Promise history" : "New relationship"}</span></div><ChevronRight size={15} /></button>; })}</div></section><section className="client-detail-panel"><div className="client-profile-heading"><div className="client-avatar client-avatar--xl">{(client.company || client.name).split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div><span className="eyebrow">Client story</span><h2>{client.name}</h2><p>{client.company || "Independent client"}{client.email ? ` · ${client.email}` : ""}</p></div></div><div className="client-stat-grid"><Metric label="Outstanding" value={formatINR(clientOutstanding)} accent={clientOutstanding ? "coral" : "teal"} /><Metric label="Recovered historically" value={formatINR(state.payments.filter((p) => clientReceivables.some((r) => r.id === p.receivableId)).reduce((sum, p) => sum + p.amountPaise, 0))} accent="teal" /><Metric label="Promises" value={String(state.promises.filter((p) => clientReceivables.some((r) => r.id === p.receivableId)).length)} /></div><Reliability clientId={client.id} state={state} /><div className="client-history"><div className="section-heading section-heading--compact"><div><span className="eyebrow">Open work</span><h3>Receivable story</h3></div><span className="timeline-count">{resolvedCount} resolved promises</span></div>{clientReceivables.map((receivable) => <button className="client-receivable" key={receivable.id} onClick={() => onOpenReceivable(receivable.id)}><div><strong>{receivable.title}</strong><span>Due {formatDate(receivable.dueDate)} · {getLatestPromise(receivable.id, state.promises) ? getPromiseStatusLabel(getLatestPromise(receivable.id, state.promises)!.status) : "No promise yet"}</span></div><strong>{formatINR(getOutstanding(receivable, state.payments))}</strong><ChevronRight size={15} /></button>)}</div></section></div>;
}

function MoreView({ theme, onToggleTheme, onSignOut, onFounder }: { theme: "light" | "dark"; onToggleTheme: () => void; onSignOut: () => void; onFounder: () => void }) {
  return <div className="more-page"><div className="more-hero"><div><span className="eyebrow">More control, less noise</span><h2>A private ledger for the awkward middle.</h2><p>Your client and receivable records are protected by authenticated, row-level security. Messages and payments are never sent automatically.</p></div><img src={BRAND.promiseIllustration} alt="Abstract hands passing a promise note" /></div><div className="settings-grid"><section className="settings-panel"><div className="settings-panel__header"><div><span className="eyebrow">Preferences</span><h3>Make it feel like yours.</h3></div><Settings2 size={18} /></div><button className="settings-row" onClick={onToggleTheme}><div className="settings-icon">{theme === "light" ? <Sun size={16} /> : <Moon size={16} />}</div><div><strong>{theme === "light" ? "Light mode" : "Dark mode"}</strong><span>Saved locally on this device.</span></div><span className="settings-value">Change</span></button><div className="settings-row settings-row--static"><div className="settings-icon"><ShieldCheck size={16} /></div><div><strong>Private workspace</strong><span>Records are isolated by authenticated ownership.</span></div><span className="status-dot" /></div><div className="settings-row settings-row--static"><div className="settings-icon"><WalletCards size={16} /></div><div><strong>Currency</strong><span>Indian rupee · ₹</span></div><span className="settings-value">INR</span></div></section><section className="settings-panel"><div className="settings-panel__header"><div><span className="eyebrow">Founder Lifetime</span><h3>Expand when you need it.</h3></div><Sparkles size={18} /></div><button className="settings-row" onClick={onFounder}><div className="settings-icon"><Sparkles size={16} /></div><div><strong>Founder access</strong><span>One-time ₹499 manual UPI verification. No payment credential is stored.</span></div><ChevronRight size={16} /></button><button className="settings-row" onClick={onSignOut}><div className="settings-icon"><ArrowUpRight size={16} /></div><div><strong>Sign out</strong><span>Return to the secure sign-in screen on this device.</span></div><ChevronRight size={16} /></button></section></div><div className="prototype-footnote"><LockKeyhole size={15} /><span>Founder access is activated only after manual review against business bank history. UPI PINs, OTPs, passwords, and bank credentials are never requested.</span></div></div>;
}

export default App;
