// Quiet Ledger style reminder: reusable surfaces carry hierarchy through typography, rules, and restrained state color.

import { useEffect, useRef, type ReactNode } from "react";
import { CalendarClock, Check, ChevronRight, CircleAlert, Info, MessageCircle, Moon, MoreHorizontal, Plus, RefreshCw, ShieldCheck, Sparkles, Sun, Users, WalletCards, X } from "lucide-react";
import { BRAND } from "@/config/brand";
import { formatDate, formatINR, getLatestPromise, getOutstanding, getReliability, priorityBreakdown, priorityReasons } from "@/lib/finance";
import type { AppSection, Client, LedgerState, PromiseStatus, Receivable } from "@/types/domain";

export const iconMap = { today: Sparkles, receivables: WalletCards, clients: Users, more: MoreHorizontal } as const;

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? "brand-mark brand-mark--compact" : "brand-mark"}><img src={BRAND.mark} alt="" aria-hidden="true" />{!compact && <div><strong>{BRAND.name}</strong><span>Promise ledger</span></div>}</div>;
}

export function StatusPill({ status }: { status: PromiseStatus | Receivable["status"] }) {
  const label = { OPEN: "Open", PARTIALLY_PAID: "Partially paid", PAID: "Paid", CANCELLED: "Cancelled", ACTIVE: "Active promise", KEPT: "Kept", PARTIALLY_KEPT: "Partially kept", BROKEN: "Promise broken", RENEGOTIATED: "Renegotiated" }[status];
  return <span className={`status-pill status-pill--${status.toLowerCase()}`}><span className="status-dot" />{label}</span>;
}

export function AppRail({ active, onNavigate, openCount = 0, workspaceName, userName }: { active: AppSection; onNavigate: (section: AppSection) => void; openCount?: number; workspaceName: string; userName: string }) {
  const items: { id: AppSection; label: string }[] = [{ id: "today", label: "Today" }, { id: "receivables", label: "Receivables" }, { id: "clients", label: "Clients" }, { id: "more", label: "More" }];
  const initials = workspaceName.split(" ").map((word) => word?.[0] ?? "").join("").slice(0, 2).toUpperCase();
  return <aside className="app-rail" aria-label="Primary navigation"><BrandMark /><div className="rail-label">Workspace</div><nav className="rail-nav">{items.map((item) => { const Icon = iconMap[item.id as keyof typeof iconMap]; return <button key={item.id} className={active === item.id ? "rail-link rail-link--active" : "rail-link"} onClick={() => onNavigate(item.id)} aria-current={active === item.id ? "page" : undefined}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.id === "today" && <span className="rail-count">{openCount}</span>}</button>; })}</nav><div className="rail-footer"><div className="rail-note"><ShieldCheck size={16} /><span>Private workspace<br /><em>RLS-protected records</em></span></div><div className="rail-user"><div className="avatar avatar--small">{initials}</div><div><strong>{workspaceName}</strong><span>{userName}</span></div></div></div></aside>;
}

export function BottomNav({ active, onNavigate }: { active: AppSection; onNavigate: (section: AppSection) => void }) {
  const items: { id: AppSection; label: string }[] = [{ id: "today", label: "Today" }, { id: "receivables", label: "Receivables" }, { id: "clients", label: "Clients" }, { id: "more", label: "More" }];
  return <nav className="bottom-nav" aria-label="Mobile navigation">{items.map((item) => { const Icon = iconMap[item.id as keyof typeof iconMap]; return <button key={item.id} className={active === item.id ? "bottom-link bottom-link--active" : "bottom-link"} onClick={() => onNavigate(item.id)} aria-current={active === item.id ? "page" : undefined}><Icon size={18} /><span>{item.label}</span></button>; })}</nav>;
}

export function PageHeader({ section, onAdd, onToggleTheme, theme }: { section: AppSection; onAdd: () => void; onToggleTheme: () => void; theme: "light" | "dark" }) {
  const title = { today: "Today", receivables: "Receivables", clients: "Clients", more: "More", empty: "Empty state", loading: "Loading example", error: "Error example" }[section];
  const dateLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());
  return <header className="page-header"><div className="page-header__left"><BrandMark compact /><div className="page-header__meta"><span className="eyebrow">{dateLabel}</span><h1>{title}</h1></div></div><div className="page-header__actions"><span className="prototype-chip"><span className="pulse-dot" />Private workspace</span><button className="icon-button theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button><button className="button-primary button-primary--compact" onClick={onAdd} aria-label="Add receivable"><Plus size={17} /><span>Add receivable</span></button></div></header>;
}

export function Metric({ label, value, accent = "default", sub }: { label: string; value: string; accent?: "default" | "teal" | "amber" | "coral"; sub?: string }) {
  return <div className={`metric metric--${accent}`}><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

export function QueueCard({ receivable, client, state, selected, onSelect, onFollowUp }: { receivable: Receivable; client: Client; state: LedgerState; selected: boolean; onSelect: () => void; onFollowUp: () => void }) {
  const outstanding = getOutstanding(receivable);
  const reasons = priorityReasons(receivable, state);
  const latest = getLatestPromise(receivable.id, state.promises);
  const priority = priorityBreakdown(receivable, state).total;
  const tone = priority >= 55 ? "critical" : priority >= 30 ? "watch" : "quiet";
  const hasBrokenHistory = reasons.some((reason) => /broken/i.test(reason.label));
  const primaryReason = hasBrokenHistory ? "Promise broken" : latest?.status === "ACTIVE" ? `Promised ${formatDate(latest.promisedDate)}` : priority >= 30 ? "Follow up today" : "Still outstanding";
  return <article className={`queue-card queue-card--${tone} ${selected ? "queue-card--selected" : ""}`}><div className="queue-card__accent" /><div className="queue-card__main"><div className="queue-card__top"><div className="client-avatar">{client.company.split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div className="queue-card__identity"><strong>{client.company}</strong><span>{client.name}</span></div><span className="priority-score">Score {priority}</span></div><div className="queue-card__amount"><strong>{formatINR(outstanding)}</strong><span>{receivable.title}</span></div><div className="queue-card__why"><strong>{primaryReason}</strong><span>{reasons.map((reason) => reason.label).join(" · ")}</span></div></div><div className="queue-card__actions"><button className="button-primary button-primary--small" onClick={onFollowUp} aria-label={`Follow up with ${client.company || client.name}`}><MessageCircle size={15} />Follow up</button><button className="text-button" onClick={onSelect} aria-label={`Open details for ${client.company || client.name}, ${formatINR(outstanding)} outstanding`}>Details <ChevronRight size={14} /></button></div>{latest?.status === "ACTIVE" && <span className="queue-card__promise"><CalendarClock size={13} /> Promised {formatDate(latest.promisedDate)}</span>}</article>;
}

export function Timeline({ receivable, state }: { receivable: Receivable; state: LedgerState }) {
  const events = state.activities.filter((activity) => activity.receivableId === receivable.id).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const promiseById = new Map(state.promises.map((promise) => [promise.id, promise]));
  // A payment activity has no figure of its own — the sum lives on the payment row,
  // which this read never joins — so the entry names the event rather than inventing ₹0.
  return <div className="timeline" aria-label="Receivable activity timeline">{events.map((event) => { const promise = event.promiseId ? promiseById.get(event.promiseId) : undefined; return <div key={event.id} className={`timeline-item ${promise?.status === "BROKEN" ? "timeline-item--critical" : ""}`}><div className="timeline-marker"><span /></div><div className="timeline-content"><div className="timeline-content__top"><span className="timeline-date">{formatDate(event.occurredAt, { day: "numeric", month: "short", year: "numeric" })}</span>{event.type === "payment" && event.amountPaise !== undefined && <span className="timeline-amount">{formatINR(event.amountPaise)} received</span>}</div><strong>{event.note}</strong>{event.snoozedUntil && <span className="timeline-sub">Returns to Today on {formatDate(event.snoozedUntil, { day: "numeric", month: "short", year: "numeric" })}</span>}{promise && <span className="timeline-sub">{promise.status === "BROKEN" ? "Original promise preserved in history" : `${promise.source} · ${formatINR(promise.promisedAmountPaise)} promised`}</span>}</div></div>; })}</div>;
}

export function Reliability({ clientId, state }: { clientId: string; state: LedgerState }) {
  const reliability = getReliability(clientId, state);
  if (!reliability.enoughHistory) return <div className="reliability reliability--muted"><Info size={15} /><div><strong>Not enough history</strong><span>Reliability appears once 3 promises have reached their outcome.</span></div></div>;
  return <div className="reliability"><div className="reliability__ring"><strong>{Math.round((reliability.kept / reliability.total) * 100)}%</strong><span>kept</span></div><div><strong>{reliability.kept} of {reliability.total} promises kept</strong><span>Average delay {reliability.averageDelay ?? 0} days · {reliability.broken} broken · {reliability.partial} partial</span></div></div>;
}

export function Sheet({ title, eyebrow, children, onClose, footer }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    const focusFirst = window.requestAnimationFrame(() => {
      // A data-entry sheet should hand the person the first thing they are here to
      // fill in, not the close control. A sheet can name that field explicitly; the
      // fallback is the first real input of the form, which is never the destructive
      // confirmation in the footer.
      const explicit = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]");
      const items = focusable();
      (explicit ?? items.find((item) => item.matches("input, select, textarea")) ?? items[0])?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => { window.cancelAnimationFrame(focusFirst); window.removeEventListener("keydown", handleKeyDown); returnFocusRef.current?.focus(); };
  }, [onClose]);

  return <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}><section ref={dialogRef} className="sheet" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><div className="sheet-handle" /><header className="sheet-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header><div className="sheet-body">{children}</div>{footer && <footer className="sheet-footer">{footer}</footer>}</section></div>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  // The refusal belongs to the field it refuses, so it is announced where that
  // field's own label is read. It sits outside the label on purpose: a message
  // inside the label becomes part of the field's name, which turns "Amount" into
  // the whole error for a screen reader.
  return <div className="field-group"><label className="field"><span>{label}{hint && <em>{hint}</em>}</span>{children}</label>{error && <p className="field__error" role="alert">{error}</p>}</div>;
}

export function EmptyStateCard({ onAdd, savedClients = 0 }: { onAdd: () => void; savedClients?: number }) {
  const freshWorkspace = savedClients === 0;
  const clientLine = savedClients === 1 ? "One client is already saved." : `${savedClients} clients are already saved.`;
  return <div className="empty-state-card"><div className="empty-state-visual"><div className="empty-orbit empty-orbit--one" /><div className="empty-orbit empty-orbit--two" /><div className="empty-anchor"><Check size={23} /></div><div className="empty-thread" /></div><div><span className="eyebrow">{freshWorkspace ? "Start with the amount you’re waiting for" : "One step from a working ledger"}</span><h2>{freshWorkspace ? "Make the next conversation easier." : "Now add the amount you are waiting on."}</h2><p>{freshWorkspace ? "Add what a client owes you. When they promise a payment date, DueWeave keeps the history and tells you when it deserves attention." : `${clientLine} Nothing is tracked until an amount and a due date are on record.`}</p><button className="button-primary" onClick={onAdd}><Plus size={16} />Add first receivable</button></div></div>;
}

export function LoadingState() {
  return <div className="state-example" role="status"><div className="skeleton skeleton--wide" /><div className="skeleton skeleton--medium" /><div className="skeleton-grid"><div className="skeleton skeleton--card" /><div className="skeleton skeleton--card" /></div><span className="eyebrow">Loading state · quiet, structural, no spinner wall</span><h2>Preparing your follow-up brief</h2></div>;
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <div className="state-example error-state" aria-live="polite"><div className="error-icon"><CircleAlert size={22} /></div><span className="eyebrow">Couldn’t load this view</span><h2>Your private ledger remains protected.</h2><p>We could not refresh this screen. Check your connection and try again; no technical details are shown here.</p><button className="button-secondary" onClick={onRetry}><RefreshCw size={16} />Try again</button></div>;
}
