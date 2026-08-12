// Quiet Ledger style reminder: reusable surfaces carry hierarchy through typography, rules, and restrained state color.

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, CalendarClock, Check, ChevronRight, CircleAlert, Info, MessageCircle, Moon, MoreHorizontal, Plus, RefreshCw, ShieldCheck, Sparkles, Sun, Users, WalletCards, WifiOff, X } from "lucide-react";
import { BRAND } from "@/config/brand";
import { formatDate, formatINR, getLatestPromise, getOutstanding, getPromiseStatusLabel, getPromisesFor, getReliability, priorityBreakdown, priorityReasons } from "@/lib/finance";
import type { AppSection, Client, DemoState, PromiseStatus, Receivable } from "@/types/domain";

export const iconMap = { today: Sparkles, receivables: WalletCards, clients: Users, more: MoreHorizontal } as const;

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? "brand-mark brand-mark--compact" : "brand-mark"}><img src={BRAND.mark} alt="" aria-hidden="true" />{!compact && <div><strong>{BRAND.name}</strong><span>Promise ledger</span></div>}</div>;
}

export function StatusPill({ status }: { status: PromiseStatus | Receivable["status"] }) {
  const label = { OPEN: "Open", PARTIALLY_PAID: "Partially paid", PAID: "Paid", CANCELLED: "Cancelled", WRITTEN_OFF: "Written off", ACTIVE: "Active promise", KEPT: "Kept", PARTIALLY_KEPT: "Partially kept", BROKEN: "Promise broken", RENEGOTIATED: "Renegotiated" }[status];
  return <span className={`status-pill status-pill--${status.toLowerCase()}`}><span className="status-dot" />{label}</span>;
}

export function AppRail({ active, onNavigate, openCount = 0, userName = "Your workspace" }: { active: AppSection; onNavigate: (section: AppSection) => void; openCount?: number; userName?: string }) {
  const items: { id: AppSection; label: string }[] = [{ id: "today", label: "Today" }, { id: "receivables", label: "Receivables" }, { id: "clients", label: "Clients" }, { id: "more", label: "More" }];
  const initials = userName.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "DW";
  return <aside className="app-rail" aria-label="Primary navigation"><BrandMark /><div className="rail-label">Workspace</div><nav className="rail-nav">{items.map((item) => { const Icon = iconMap[item.id as keyof typeof iconMap]; return <button key={item.id} className={active === item.id ? "rail-link rail-link--active" : "rail-link"} onClick={() => onNavigate(item.id)} aria-current={active === item.id ? "page" : undefined}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.id === "today" && <span className="rail-count">{openCount}</span>}</button>; })}</nav><div className="rail-footer"><div className="rail-note"><ShieldCheck size={16} /><span>Private workspace<br /><em>RLS-protected records</em></span></div><div className="rail-user"><div className="avatar avatar--small">{initials}</div><div><strong>{userName}</strong><span>Private ledger</span></div></div></div></aside>;
}

export function BottomNav({ active, onNavigate }: { active: AppSection; onNavigate: (section: AppSection) => void }) {
  const items: { id: AppSection; label: string }[] = [{ id: "today", label: "Today" }, { id: "receivables", label: "Receivables" }, { id: "clients", label: "Clients" }, { id: "more", label: "More" }];
  return <nav className="bottom-nav" aria-label="Mobile navigation">{items.map((item) => { const Icon = iconMap[item.id as keyof typeof iconMap]; return <button key={item.id} className={active === item.id ? "bottom-link bottom-link--active" : "bottom-link"} onClick={() => onNavigate(item.id)} aria-current={active === item.id ? "page" : undefined}><Icon size={18} /><span>{item.label}</span></button>; })}</nav>;
}

export function PageHeader({ section, onAdd, onToggleTheme, theme }: { section: AppSection; onAdd: () => void; onToggleTheme: () => void; theme: "light" | "dark" }) {
  const title = { today: "Today", receivables: "Receivables", clients: "Clients", more: "More", empty: "Empty state", loading: "Loading example", error: "Error example" }[section];
  const dateLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());
  return <header className="page-header"><div className="page-header__left"><BrandMark compact /><div className="page-header__meta"><span className="eyebrow">{dateLabel}</span><h1>{title}</h1></div></div><div className="page-header__actions"><span className="prototype-chip"><span className="pulse-dot" />Private workspace</span><button className="icon-button theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button><button className="button-primary button-primary--compact" onClick={onAdd}><Plus size={17} /><span>Add receivable</span></button></div></header>;
}

export function Metric({ label, value, accent = "default", sub }: { label: string; value: string; accent?: "default" | "teal" | "amber" | "coral"; sub?: string }) {
  return <div className={`metric metric--${accent}`}><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

export function QueueCard({ receivable, client, state, selected, onSelect, onFollowUp }: { receivable: Receivable; client: Client; state: DemoState; selected: boolean; onSelect: () => void; onFollowUp: () => void }) {
  const outstanding = getOutstanding(receivable, state.payments);
  const reasons = priorityReasons(receivable, state);
  const latest = getLatestPromise(receivable.id, state.promises);
  const priority = priorityBreakdown(receivable, state).total;
  const tone = priority >= 55 ? "critical" : priority >= 30 ? "watch" : "quiet";
  const hasBrokenHistory = reasons.some((reason) => /broken/i.test(reason.label));
  const primaryReason = hasBrokenHistory ? "Promise broken" : latest?.status === "ACTIVE" ? `Promised ${formatDate(latest.promisedDate)}` : priority >= 30 ? "Follow up today" : "Still outstanding";
  return <article className={`queue-card queue-card--${tone} ${selected ? "queue-card--selected" : ""}`} onClick={onSelect} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onSelect(); }} aria-label={`${client.company}, ${formatINR(outstanding)} outstanding, ${primaryReason}`}><div className="queue-card__accent" /><div className="queue-card__main"><div className="queue-card__top"><div className="client-avatar">{client.company.split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div className="queue-card__identity"><strong>{client.company}</strong><span>{client.name}</span></div><span className="priority-score">Score {priority}</span></div><div className="queue-card__amount"><strong>{formatINR(outstanding)}</strong><span>{receivable.title}</span></div><div className="queue-card__why"><strong>{primaryReason}</strong><span>{reasons.map((reason) => reason.label).join(" · ")}</span></div></div><div className="queue-card__actions"><button className="button-primary button-primary--small" onClick={(event) => { event.stopPropagation(); onFollowUp(); }}><MessageCircle size={15} />Follow up</button><button className="text-button" onClick={(event) => { event.stopPropagation(); onSelect(); }}>Details <ChevronRight size={14} /></button></div>{latest?.status === "ACTIVE" && <span className="queue-card__promise"><CalendarClock size={13} /> Promised {formatDate(latest.promisedDate)}</span>}</article>;
}

export function Timeline({ receivable, state }: { receivable: Receivable; state: DemoState }) {
  const events = state.activities.filter((activity) => activity.receivableId === receivable.id).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const promiseById = new Map(state.promises.map((promise) => [promise.id, promise]));
  return <div className="timeline" aria-label="Receivable activity timeline">{events.map((event) => { const promise = event.promiseId ? promiseById.get(event.promiseId) : undefined; return <div key={event.id} className={`timeline-item ${event.type === "broken" ? "timeline-item--critical" : ""}`}><div className="timeline-marker"><span /></div><div className="timeline-content"><div className="timeline-content__top"><span className="timeline-date">{formatDate(event.occurredAt, { day: "numeric", month: "short", year: "numeric" })}</span>{event.type === "payment" && <span className="timeline-amount">{formatINR(event.amountPaise ?? 0)} received</span>}</div><strong>{event.note}</strong>{event.snoozedUntil && <span className="timeline-sub">Returns to Today on {formatDate(event.snoozedUntil, { day: "numeric", month: "short", year: "numeric" })}</span>}{promise && <span className="timeline-sub">{promise.status === "BROKEN" ? "Original promise preserved in history" : `${promise.source} · ${formatINR(promise.promisedAmountPaise)} promised`}</span>}</div></div>; })}</div>;
}

export function Reliability({ clientId, state }: { clientId: string; state: DemoState }) {
  const reliability = getReliability(clientId, state);
  if (!reliability.enoughHistory) return <div className="reliability reliability--muted"><Info size={15} /><div><strong>Not enough history</strong><span>Reliability appears after 3 resolved promises.</span></div></div>;
  return <div className="reliability"><div className="reliability__ring"><strong>{Math.round((reliability.kept / reliability.total) * 100)}%</strong><span>kept</span></div><div><strong>{reliability.kept} of {reliability.total} promises kept</strong><span>Average delay {reliability.averageDelay ?? 0} days · {reliability.broken} broken · {reliability.partial} partial</span></div></div>;
}

export function Sheet({ title, eyebrow, children, onClose, footer }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    const focusFirst = window.requestAnimationFrame(() => focusable()[0]?.focus());
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

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}{hint && <em>{hint}</em>}</span>{children}</label>;
}

export function EmptyStateCard({ onAdd }: { onAdd: () => void }) {
  return <div className="empty-state-card"><div className="empty-state-visual"><div className="empty-orbit empty-orbit--one" /><div className="empty-orbit empty-orbit--two" /><div className="empty-anchor"><Check size={23} /></div><div className="empty-thread" /></div><div><span className="eyebrow">Start with the amount you’re waiting for</span><h2>Make the next conversation easier.</h2><p>Add what a client owes you. When they promise a payment date, DueWeave keeps the history and tells you when it deserves attention.</p><button className="button-primary" onClick={onAdd}><Plus size={16} />Add first receivable</button></div></div>;
}

export function LoadingState() {
  return <div className="state-example"><div className="skeleton skeleton--wide" /><div className="skeleton skeleton--medium" /><div className="skeleton-grid"><div className="skeleton skeleton--card" /><div className="skeleton skeleton--card" /></div><span className="eyebrow">Loading state · quiet, structural, no spinner wall</span><h2>Preparing your follow-up brief</h2></div>;
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <div className="state-example error-state"><div className="error-icon"><CircleAlert size={22} /></div><span className="eyebrow">Couldn’t load this view</span><h2>Your private ledger remains protected.</h2><p>We could not refresh this screen. Check your connection and try again; no technical details are shown here.</p><button className="button-secondary" onClick={onRetry}><RefreshCw size={16} />Try again</button></div>;
}
