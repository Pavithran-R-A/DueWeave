// Quiet Ledger style reminder: sheets reduce the emotional and cognitive cost of action; every form is short, editable, and explicit about what DueWeave does not do for you.

import { FormEvent, useState } from "react";
import { ArrowUpRight, Check, Copy, FileText, MessageCircle, RotateCcw, ShieldCheck } from "lucide-react";
import { feedback } from "@/components/ui/sonner";
import { addIndiaBusinessDays, formatDate, formatINR, getOutstanding, parseINRToPaise } from "@/lib/finance";
import { contactNote, followUpDraft, messageValues, suggestedTemplate, TEMPLATE_ORDER, templateLabels, type FollowUpTemplate } from "@/lib/follow-up";
import { whatsappActionLabel, whatsappRecipient, whatsappUrl } from "@/lib/whatsapp";
import { newRequestId } from "@/lib/request-id";
import { todayInIndia } from "@/lib/business-clock";
import { BUSINESS_NAME_LIMIT, DISPLAY_NAME_LIMIT, validateBusinessName, validateDisplayName } from "@/lib/profile";
import type { Client, LedgerState, PaymentMethod, PromiseRecord, PromiseSource, Receivable } from "@/types/domain";
import { Field, Sheet } from "@/components/finance-ui";

const inputClass = "form-input";

export function AddClientSheet({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (input: { name: string; company: string; phone: string; email: string; notes: string }) => void }) {
  const [form, setForm] = useState({ name: "", company: "", phone: "", email: "", notes: "" });
  const [nameError, setNameError] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); if (busy) return; if (!form.name.trim()) { setNameError("Add a client name before saving."); return; } onSubmit(form); }
  return <Sheet title="Add client" eyebrow="Keep the relationship clear" onClose={onClose} footer={<><button className="button-secondary" onClick={onClose}>Cancel</button><button form="add-client-form" className="button-primary" disabled={busy} aria-busy={busy}>Save client <ArrowUpRight size={16} /></button></>}><form id="add-client-form" className="form-stack" onSubmit={submit} noValidate><p className="sheet-intro">A client can come first. Add a receivable when an invoice is ready to follow.</p><div className="form-grid form-grid--two"><Field label="Client name" error={nameError}><input className={inputClass} data-autofocus value={form.name} onChange={(event) => { setForm({ ...form, name: event.target.value }); setNameError(""); }} placeholder="Full name" required aria-invalid={Boolean(nameError)} /></Field><Field label="Company" hint="Optional"><input className={inputClass} value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Their business name" /></Field></div><div className="form-grid form-grid--two"><Field label="Phone" hint="Optional · any Indian format you already use"><input className={inputClass} inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="98765 43210" /></Field><Field label="Email" hint="Optional"><input className={inputClass} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@company.com" /></Field></div><Field label="Note" hint="Optional"><textarea className={`${inputClass} textarea`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="What should you remember later?" rows={3} /></Field></form></Sheet>;
}

export type ReceivableSubmitInput =
  | { mode: "existing"; clientId: string; receivableLabel: string; amountPaise: number; dueDate: string; invoiceRef: string; notes: string }
  | { mode: "new"; clientName: string; company: string; receivableLabel: string; amountPaise: number; dueDate: string; invoiceRef: string; phone: string; email: string; notes: string };

export function AddReceivableSheet({ clients, busy, onClose, onSubmit }: { clients: Client[]; busy: boolean; onClose: () => void; onSubmit: (input: ReceivableSubmitInput) => void }) {
  const [mode, setMode] = useState<"existing" | "new">(clients.length ? "existing" : "new");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ clientName: "", company: "", receivableLabel: "", amount: "", dueDate: todayInIndia(), invoiceRef: "", phone: "", email: "", notes: "" });
  const matchingClients = clients.filter((client) => `${client.name} ${client.company}`.toLowerCase().includes(query.trim().toLowerCase()));
  const [errors, setErrors] = useState<{ client?: string; clientName?: string; amount?: string; dueDate?: string }>({});
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const amountPaise = parseINRToPaise(form.amount);
    const next: typeof errors = {};
    if (!amountPaise) next.amount = "Enter an amount greater than zero.";
    if (!form.dueDate) next.dueDate = "Choose the date this is due.";
    if (mode === "existing") {
      if (!selectedClientId) next.client = "Choose an existing client, or switch to New client.";
    } else if (!form.clientName.trim()) {
      next.clientName = "Add a client name before saving.";
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    if (mode === "existing") {
      onSubmit({ mode, clientId: selectedClientId, receivableLabel: form.receivableLabel, amountPaise: amountPaise!, dueDate: form.dueDate, invoiceRef: form.invoiceRef, notes: form.notes });
      return;
    }
    onSubmit({ mode, clientName: form.clientName, company: form.company, receivableLabel: form.receivableLabel, amountPaise: amountPaise!, dueDate: form.dueDate, invoiceRef: form.invoiceRef, phone: form.phone, email: form.email, notes: form.notes });
  }
  return <Sheet title="Add receivable" eyebrow="Start after the invoice is already out" onClose={onClose} footer={<><button className="button-secondary" onClick={onClose}>Cancel</button><button form="add-receivable-form" className="button-primary" disabled={busy} aria-busy={busy}>Save receivable <ArrowUpRight size={16} /></button></>}><form id="add-receivable-form" className="form-stack" onSubmit={submit} noValidate><p className="sheet-intro">Choose the client deliberately. DueWeave never merges people by name.</p><fieldset className="client-choice"><legend>Who is this receivable for?</legend><div className="client-choice__modes"><button type="button" aria-pressed={mode === "existing"} className={mode === "existing" ? "is-active" : ""} onClick={() => setMode("existing")}>Existing client</button><button type="button" aria-pressed={mode === "new"} className={mode === "new" ? "is-active" : ""} onClick={() => setMode("new")}>New client</button></div>{mode === "existing" ? <div className="client-picker"><Field label="Search existing clients" error={errors.client}><input className={inputClass} value={query} onChange={(event) => { setQuery(event.target.value); setErrors({ ...errors, client: undefined }); }} placeholder="Search name or company" autoComplete="off" aria-invalid={Boolean(errors.client)} /></Field><div className="client-picker__results" role="listbox" aria-label="Matching clients">{matchingClients.length ? matchingClients.map((client) => <button type="button" role="option" aria-selected={client.id === selectedClientId} className={client.id === selectedClientId ? "is-selected" : ""} key={client.id} onClick={() => { setSelectedClientId(client.id); setErrors({ ...errors, client: undefined }); }}><strong>{client.name}</strong><span>{client.company || "Independent client"}</span></button>) : <p>No matching client. Choose New client to add one explicitly.</p>}</div></div> : <div className="form-grid form-grid--two"><Field label="Client name" error={errors.clientName}><input className={inputClass} data-autofocus value={form.clientName} onChange={(event) => { setForm({ ...form, clientName: event.target.value }); setErrors({ ...errors, clientName: undefined }); }} placeholder="Full name" required aria-invalid={Boolean(errors.clientName)} /></Field><Field label="Company" hint="Optional"><input className={inputClass} value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Their business name" /></Field></div>}</fieldset><div className="form-grid form-grid--two"><Field label="Amount" error={errors.amount}><div className="input-prefix"><span>₹</span><input className={inputClass} inputMode="decimal" value={form.amount} onChange={(event) => { setForm({ ...form, amount: event.target.value }); setErrors({ ...errors, amount: undefined }); }} placeholder="28,000" required aria-invalid={Boolean(errors.amount)} /></div></Field><Field label="Due date" error={errors.dueDate}><input className={inputClass} type="date" value={form.dueDate} onChange={(event) => { setForm({ ...form, dueDate: event.target.value }); setErrors({ ...errors, dueDate: undefined }); }} required aria-invalid={Boolean(errors.dueDate)} /></Field></div><Field label="What is this for?" hint="Optional"><input className={inputClass} value={form.receivableLabel} onChange={(event) => setForm({ ...form, receivableLabel: event.target.value })} placeholder="e.g. August design retainer" /></Field><Field label="Invoice or reference" hint="Optional"><input className={inputClass} value={form.invoiceRef} onChange={(event) => setForm({ ...form, invoiceRef: event.target.value })} placeholder="As printed on the invoice" /></Field>{mode === "new" && <div className="form-grid form-grid--two"><Field label="Phone" hint="Optional · any Indian format you already use"><input className={inputClass} inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="98765 43210" /></Field><Field label="Email" hint="Optional"><input className={inputClass} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@company.com" /></Field></div>}<Field label="Note" hint="Optional"><textarea className={`${inputClass} textarea`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="What should you remember later?" rows={3} /></Field></form></Sheet>;
}

export function EditClientSheet({ client, busy, onClose, onSubmit }: { client: Client; busy: boolean; onClose: () => void; onSubmit: (input: { name: string; company: string; phone: string; email: string; notes: string }) => void }) {
  const [form, setForm] = useState({ name: client.name, company: client.company, phone: client.phone ?? "", email: client.email ?? "", notes: client.notes ?? "" });
  const [nameError, setNameError] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); if (busy) return; if (!form.name.trim()) { setNameError("Keep a client name before saving."); return; } onSubmit(form); }
  return <Sheet title="Edit client" eyebrow="Names and contact details only" onClose={onClose} footer={<><button className="button-secondary" onClick={onClose}>Cancel</button><button form="edit-client-form" className="button-primary" disabled={busy} aria-busy={busy}>Save changes <ArrowUpRight size={16} /></button></>}><form id="edit-client-form" className="form-stack" onSubmit={submit} noValidate><p className="sheet-intro">Outstanding amounts, promises, and payment history stay exactly as they were. This sheet only changes how the client is written and reached.</p><div className="form-grid form-grid--two"><Field label="Client name" error={nameError}><input className={inputClass} data-autofocus value={form.name} onChange={(event) => { setForm({ ...form, name: event.target.value }); setNameError(""); }} placeholder="Full name" required aria-invalid={Boolean(nameError)} /></Field><Field label="Company" hint="Optional"><input className={inputClass} value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Their business name" /></Field></div><div className="form-grid form-grid--two"><Field label="Phone" hint="Optional · any Indian format you already use"><input className={inputClass} inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="98765 43210" /></Field><Field label="Email" hint="Optional"><input className={inputClass} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@company.com" /></Field></div><Field label="Note" hint="Optional"><textarea className={`${inputClass} textarea`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="What should you remember later?" rows={3} /></Field></form></Sheet>;
}

export function EditProfileSheet({ displayName, businessName, email, busy, saveError, onClose, onSubmit }: { displayName: string; businessName: string; email: string; busy: boolean; saveError: string; onClose: () => void; onSubmit: (input: { displayName: string; businessName: string }) => void }) {
  const [form, setForm] = useState({ displayName, businessName });
  const [errors, setErrors] = useState({ displayName: "", businessName: "" });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const next = { displayName: validateDisplayName(form.displayName), businessName: validateBusinessName(form.businessName) };
    setErrors(next);
    if (next.displayName || next.businessName) return;
    onSubmit({ displayName: form.displayName.trim(), businessName: form.businessName.trim() });
  }
  // The row's own concurrency token travels with the write, so a profile saved on
  // another device in the meantime is refused here rather than overwritten.
  return <Sheet title="Edit workspace profile" eyebrow="The two names your ledger shows" onClose={onClose} footer={<><button className="button-secondary" onClick={onClose}>Cancel</button><button form="edit-profile-form" className="button-primary" disabled={busy} aria-busy={busy}>Save changes <Check size={16} /></button></>}><form id="edit-profile-form" className="form-stack" onSubmit={submit} noValidate><p className="sheet-intro">These names appear inside your own workspace. Nothing here changes amounts, promises, or history.</p><div className="field"><label className="field__label" htmlFor="profile-display-name">Your name</label><input id="profile-display-name" className={inputClass} autoComplete="name" value={form.displayName} aria-invalid={Boolean(errors.displayName)} aria-describedby={errors.displayName ? "profile-display-name-error" : undefined} onChange={(event) => { setForm({ ...form, displayName: event.target.value }); setErrors({ ...errors, displayName: "" }); }} /><p className="field__hint">Up to {DISPLAY_NAME_LIMIT} characters.</p>{errors.displayName && <p className="field__error" id="profile-display-name-error" role="alert">{errors.displayName}</p>}</div><div className="field"><label className="field__label" htmlFor="profile-business-name">Business or workspace name</label><input id="profile-business-name" className={inputClass} autoComplete="organization" value={form.businessName} aria-invalid={Boolean(errors.businessName)} aria-describedby={errors.businessName ? "profile-business-name-error" : undefined} onChange={(event) => { setForm({ ...form, businessName: event.target.value }); setErrors({ ...errors, businessName: "" }); }} /><p className="field__hint">Up to {BUSINESS_NAME_LIMIT} characters.</p>{errors.businessName && <p className="field__error" id="profile-business-name-error" role="alert">{errors.businessName}</p>}</div>{saveError && <p className="field__error" role="alert">{saveError}</p>}<div className="identity-list"><div className="identity-row"><span className="identity-row__label">Sign-in email</span><strong>{email}</strong></div><div className="identity-row"><span className="identity-row__label">Currency</span><strong>Indian rupee · INR</strong></div><div className="identity-row"><span className="identity-row__label">Business calendar</span><strong>India · Asia/Kolkata</strong></div></div><p className="sheet-intro">The email, currency, and working calendar are set by how DueWeave works, so they are shown rather than offered for editing.</p></form></Sheet>;
}

export function EditReceivableSheet({ receivable, client, busy, onClose, onSubmit }: { receivable: Receivable; client?: Client; busy: boolean; onClose: () => void; onSubmit: (input: { label: string; invoiceRef: string; notes: string }) => void }) {
  const [form, setForm] = useState({ label: receivable.title, invoiceRef: receivable.invoiceRef ?? "", notes: receivable.notes ?? "" });
  const [labelError, setLabelError] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); if (busy) return; if (!form.label.trim()) { setLabelError("Keep a short label for this receivable."); return; } onSubmit(form); }
  return <Sheet title="Edit receivable details" eyebrow={client?.company} onClose={onClose} footer={<><button className="button-secondary" onClick={onClose}>Cancel</button><button form="edit-receivable-form" className="button-primary" disabled={busy} aria-busy={busy}>Save details <Check size={16} /></button></>}><form id="edit-receivable-form" className="form-stack" onSubmit={submit} noValidate><div className="payment-summary"><span>Unchanged for this receivable</span><small>The amount, the due date, and the owning client stay exactly as they were. Money history is never rewritten here.</small><div className="payment-summary__breakdown"><div className="payment-summary__row"><span>Amount due</span><strong>{formatINR(receivable.amountDuePaise)}</strong></div><div className="payment-summary__row"><span>Due date</span><strong>{formatDate(receivable.dueDate)}</strong></div><div className="payment-summary__row"><span>Client</span><strong>{client?.company || client?.name || "Already recorded"}</strong></div></div></div><Field label="What is this for?" error={labelError}><input className={inputClass} data-autofocus value={form.label} onChange={(event) => { setForm({ ...form, label: event.target.value }); setLabelError(""); }} placeholder="e.g. August design retainer" required aria-invalid={Boolean(labelError)} /></Field><Field label="Invoice or reference" hint="Optional"><input className={inputClass} value={form.invoiceRef} onChange={(event) => setForm({ ...form, invoiceRef: event.target.value })} placeholder="As printed on the invoice" /></Field><Field label="Note" hint="Optional"><textarea className={`${inputClass} textarea`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="What should you remember later?" rows={3} /></Field></form></Sheet>;
}

export interface PromiseSubmitInput {
  amountPaise: number;
  madeOn: string;
  promisedDate: string;
  source: PromiseSource;
  note: string;
  requestId: string;
}

export function AddPromiseSheet({ receivable, client, busy, onClose, onSubmit }: { receivable: Receivable; client?: Client; busy: boolean; onClose: () => void; onSubmit: (input: PromiseSubmitInput) => void }) {
  const today = todayInIndia();
  const [form, setForm] = useState({ amount: String(getOutstanding(receivable) / 100), madeOn: today, promisedDate: today, source: "WhatsApp" as PromiseSource, note: "" });
  // One identity for this opened form: if the save is retried the database
  // replays the first result instead of writing a second promise.
  const [requestId] = useState(newRequestId);
  const outstanding = getOutstanding(receivable);
  const [errors, setErrors] = useState<{ amount?: string; madeOn?: string; promisedDate?: string }>({});
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    // Each refusal is placed on the field that caused it. A toast elsewhere on the
    // screen is not something a person reading the form can act on.
    const next: typeof errors = {};
    const amountPaise = parseINRToPaise(form.amount);
    if (!amountPaise) next.amount = "Enter a promise amount greater than zero.";
    else if (amountPaise > outstanding) next.amount = `That is more than the ${formatINR(outstanding)} still outstanding.`;
    if (!form.madeOn) next.madeOn = "Choose the day the promise was made.";
    else if (form.madeOn > today) next.madeOn = "A promise cannot be dated as made in the future.";
    if (!form.promisedDate) next.promisedDate = "Choose the date the payment is promised.";
    else if (!next.madeOn && form.promisedDate < form.madeOn) next.promisedDate = "Promise date cannot be earlier than when the promise was made.";
    setErrors(next);
    if (!amountPaise || next.amount || next.madeOn || next.promisedDate) return;
    // The two dates are the customer's own chronology, so the form asks for both
    // and never derives one from the other.
    onSubmit({ amountPaise, madeOn: form.madeOn, promisedDate: form.promisedDate, source: form.source, note: form.note, requestId });
  }
  return <Sheet title="Record a new promise" eyebrow={client?.company} onClose={onClose} footer={<><button className="button-secondary" onClick={onClose}>Cancel</button><button form="promise-form" className="button-primary" disabled={busy} aria-busy={busy}>Keep this promise <Check size={16} /></button></>}><form id="promise-form" className="form-stack" onSubmit={submit} noValidate><div className="context-band"><div><span>Still outside</span><strong>{formatINR(outstanding)}</strong></div><FileText size={18} /></div><p className="sheet-intro">A new promise adds to the story. It never overwrites what happened before.</p><Field label="Promised amount" error={errors.amount}><div className="input-prefix"><span>₹</span><input className={inputClass} data-autofocus inputMode="decimal" value={form.amount} onChange={(event) => { setForm({ ...form, amount: event.target.value }); setErrors({ ...errors, amount: undefined }); }} required aria-invalid={Boolean(errors.amount)} /></div></Field><div className="form-grid form-grid--two"><Field label="Promise made on" hint="The day the customer actually committed. Change it only when entering an older promise." error={errors.madeOn}><input className={inputClass} type="date" max={today} value={form.madeOn} onChange={(event) => { setForm({ ...form, madeOn: event.target.value }); setErrors({ ...errors, madeOn: undefined }); }} required aria-invalid={Boolean(errors.madeOn)} /></Field><Field label="Promised date" error={errors.promisedDate}><input className={inputClass} type="date" min={form.madeOn} value={form.promisedDate} onChange={(event) => { setForm({ ...form, promisedDate: event.target.value }); setErrors({ ...errors, promisedDate: undefined }); }} required aria-invalid={Boolean(errors.promisedDate)} /></Field></div><Field label="Source"><select className={inputClass} value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value as PromiseSource })}>{["WhatsApp", "Call", "Email", "Meeting", "Other"].map((source) => <option key={source} value={source}>{source}</option>)}</select></Field><Field label="Note" hint="Optional"><textarea className={`${inputClass} textarea`} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="What did they say?" rows={3} /></Field></form></Sheet>;
}

export interface PaymentSubmitInput {
  amountPaise: number;
  paidDate: string;
  method: PaymentMethod;
  reference: string;
  requestId: string;
}

export function PaymentSheet({ receivable, busy, onClose, onSubmit }: { receivable: Receivable; busy: boolean; onClose: () => void; onSubmit: (input: PaymentSubmitInput) => void }) {
  const [form, setForm] = useState({ amount: String(getOutstanding(receivable) / 100), paidDate: todayInIndia(), method: "UPI" as PaymentMethod, reference: "" });
  const [requestId] = useState(newRequestId);
  const today = todayInIndia();
  const outstanding = getOutstanding(receivable);
  const enteredAmountPaise = parseINRToPaise(form.amount) ?? 0;
  const remainingAfter = Math.max(0, outstanding - enteredAmountPaise);
  const [errors, setErrors] = useState<{ amount?: string; date?: string }>({});
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const amountPaise = parseINRToPaise(form.amount);
    const next: typeof errors = {};
    if (!amountPaise) next.amount = "Enter an amount greater than zero.";
    else if (amountPaise > outstanding) next.amount = `That is more than the ${formatINR(outstanding)} still outstanding.`;
    if (form.paidDate > today) next.date = "A payment cannot be dated in the future.";
    setErrors(next);
    if (next.amount || next.date) return;
    onSubmit({ amountPaise: amountPaise!, paidDate: form.paidDate, method: form.method, reference: form.reference, requestId });
  }
  return <Sheet title="Record payment" eyebrow="Update the money story" onClose={onClose} footer={<><button className="button-secondary" onClick={onClose}>Cancel</button><button form="payment-form" className="button-primary" disabled={busy} aria-busy={busy}>Record payment <Check size={16} /></button></>}><form id="payment-form" className="form-stack" onSubmit={submit} noValidate><div className="payment-summary"><span>Currently outstanding</span><strong>{formatINR(outstanding)}</strong><small>Partial payments are welcome. The remaining amount stays visible.</small><div className="payment-summary__breakdown"><div className="payment-summary__row"><span>Received now</span><strong>{formatINR(Math.min(enteredAmountPaise, outstanding))}</strong></div><div className="payment-summary__row"><span>Still outstanding after</span><strong>{formatINR(remainingAfter)}</strong></div></div>{enteredAmountPaise > 0 && remainingAfter > 0 && <span className="status-pill status-pill--partially_kept">Partially kept</span>}</div><div className="form-grid form-grid--two"><Field label="Amount" error={errors.amount}><div className="input-prefix"><span>₹</span><input className={inputClass} data-autofocus inputMode="decimal" value={form.amount} onChange={(event) => { setForm({ ...form, amount: event.target.value }); setErrors({ ...errors, amount: undefined }); }} required aria-invalid={Boolean(errors.amount)} /></div></Field><Field label="Date" hint="Backdate freely; the future has not happened" error={errors.date}><input className={inputClass} type="date" max={today} value={form.paidDate} onChange={(event) => { setForm({ ...form, paidDate: event.target.value }); setErrors({ ...errors, date: undefined }); }} required aria-invalid={Boolean(errors.date)} /></Field></div><Field label="Method"><select className={inputClass} value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value as PaymentMethod })}>{["UPI", "Bank transfer", "Cash", "Other"].map((method) => <option key={method} value={method}>{method}</option>)}</select></Field><Field label="Reference" hint="Optional"><input className={inputClass} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} placeholder="e.g. UTR or note" /></Field></form></Sheet>;
}

export function CloseReceivableSheet({ receivable, client, paidPaise, busy, onClose, onSubmit }: { receivable: Receivable; client?: Client; paidPaise: number; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); if (busy) return; if (!reason.trim()) { setReasonError("Add a short reason before closing this receivable."); return; } onSubmit(reason.trim()); }
  return <Sheet title="Close this receivable" eyebrow={client?.company} onClose={onClose} footer={<><button className="button-secondary" onClick={onClose}>Keep it open</button><button form="close-receivable-form" className="button-primary" disabled={busy || paidPaise > 0} aria-busy={busy}>Close receivable <Check size={16} /></button></>}><form id="close-receivable-form" className="form-stack" onSubmit={submit} noValidate><div className="payment-summary"><span>Closing is only possible while nothing has been received</span><strong>{formatINR(receivable.amountDuePaise)} recorded as due</strong><small>{paidPaise > 0 ? `${formatINR(paidPaise)} has already arrived, so this receivable keeps its remaining balance instead of closing.` : "The amount, the invoice reference, and every promise stay in the timeline either way. Nothing is deleted."}</small></div><Field label="Why is it being closed?" hint="Up to 200 characters" error={reasonError}><textarea className={`${inputClass} textarea`} data-autofocus value={reason} onChange={(event) => { setReason(event.target.value); setReasonError(""); }} maxLength={200} rows={3} aria-invalid={Boolean(reasonError)} placeholder="e.g. The client settled this outside DueWeave and the invoice was withdrawn." /></Field></form></Sheet>;
}

// Only a promise that has not reached its outcome can be withdrawn, so the
// sheet is offered for an active commitment and says plainly what happens.
export function WithdrawPromiseSheet({ promise, client, busy, onClose, onSubmit }: { promise: PromiseRecord; client?: Client; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); if (busy) return; if (!reason.trim()) { setReasonError("Add a short reason before withdrawing this promise."); return; } onSubmit(reason.trim()); }
  return <Sheet title="Withdraw this promise" eyebrow={client?.company} onClose={onClose} footer={<><button className="button-secondary" onClick={onClose}>Keep it</button><button form="withdraw-promise-form" className="button-primary" disabled={busy} aria-busy={busy}>Withdraw promise <Check size={16} /></button></>}><form id="withdraw-promise-form" className="form-stack" onSubmit={submit} noValidate><div className="payment-summary"><span>An active commitment that no longer stands</span><strong>{formatINR(promise.promisedAmountPaise)} promised by {formatDate(promise.promisedDate)}</strong><small>Withdrawing records the promise as withdrawn and keeps it in the timeline. Nothing is deleted, and no money changes.</small></div><Field label="Why is it being withdrawn?" hint="Up to 200 characters" error={reasonError}><textarea className={`${inputClass} textarea`} data-autofocus value={reason} onChange={(event) => { setReason(event.target.value); setReasonError(""); }} maxLength={200} rows={3} aria-invalid={Boolean(reasonError)} placeholder="e.g. The client asked to drop this date and will confirm a new one." /></Field></form></Sheet>;
}

// The follow-up sheet prepares words and hands them over. Opening WhatsApp, copying
// a message and choosing a tone are all reversible acts that write nothing: only an
// explicit confirmation inside this sheet becomes a timeline event, and even then the
// ledger remembers the fact and the context, never the draft.
export function FollowUpSheet({ receivable, client, state, onClose, onConfirmContact }: { receivable: Receivable; client: Client; state: LedgerState; onClose: () => void; onConfirmContact: (note: string) => void }) {
  const suggested = suggestedTemplate(receivable, state);
  const [template, setTemplate] = useState<FollowUpTemplate>(suggested);
  const [message, setMessage] = useState(() => followUpDraft(suggested, messageValues(client, receivable, state)));
  const [whatsappOpened, setWhatsappOpened] = useState(false);
  const recipient = whatsappRecipient(client.phone);
  const waUrl = whatsappUrl(recipient, message);
  function chooseTemplate(next: FollowUpTemplate) {
    setTemplate(next);
    setMessage(followUpDraft(next, messageValues(client, receivable, state)));
  }
  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      feedback.success("Message copied", { description: "Paste it into WhatsApp whenever you are ready." });
    } catch {
      feedback.error("Couldn’t copy automatically", { description: "Select the message and copy it manually." });
    }
  }
  const tone = templateLabels[template];
  return <Sheet title="Choose the next message" eyebrow={`${client.company || client.name} · ${templateLabels[suggested]}`} onClose={onClose} footer={<><button className="button-secondary" onClick={() => { void copyMessage(); }}><Copy size={15} />Copy message</button><a className="button-primary" href={waUrl} target="_blank" rel="noopener noreferrer" onClick={() => setWhatsappOpened(true)}><MessageCircle size={16} />{whatsappActionLabel(recipient, client.company || client.name)}</a></>}><div className="message-tone"><div className="tone-mark"><MessageCircle size={17} /></div><div><strong>{tone}</strong><span>Editable, respectful, and never sent automatically.</span></div></div><div className="template-choice" role="radiogroup" aria-label="Message tone">{TEMPLATE_ORDER.map((key) => <label className={`template-choice__option ${key === template ? "is-active" : ""}`} key={key}><input type="radio" name="follow-up-template" value={key} aria-label={templateLabels[key]} checked={key === template} onChange={() => chooseTemplate(key)} /><span>{templateLabels[key]}</span>{key === suggested && <em className="template-choice__suggested">Suggested</em>}</label>)}</div><label className="field"><span>Message to send <em>Edit freely — it stays on this screen.</em></span><textarea className={`${inputClass} textarea message-editor`} value={message} onChange={(event) => setMessage(event.target.value)} rows={8} /></label><div className="message-actions"><button className="text-button" type="button" onClick={() => chooseTemplate(suggested)}>Reset to suggested <RotateCcw size={13} /></button><span className="message-actions__privacy"><ShieldCheck size={14} />You stay in control of Send.</span></div><div className="contact-truth">{whatsappOpened && <p className="contact-truth__note" role="status"><ShieldCheck size={14} />WhatsApp opened. DueWeave cannot tell whether you pressed Send.</p>}<div className="contact-truth__choices"><button className="button-primary button-primary--small" type="button" onClick={() => onConfirmContact(contactNote({ channel: "whatsapp", template }))}><Check size={15} />I sent it — mark contacted</button><button className="text-button" type="button" onClick={() => onConfirmContact(contactNote({ channel: "other" }))}>Contacted some other way</button></div></div></Sheet>;
}

export function SnoozeSheet({ onClose, onSubmit }: { onClose: () => void; onSubmit: (until: string) => void }) {
  const [until, setUntil] = useState(() => addIndiaBusinessDays(todayInIndia(), 1));
  const [dateError, setDateError] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); if (until < todayInIndia()) { setDateError("Choose today or a future date."); return; } onSubmit(until); }
  return <Sheet title="Snooze follow-up" eyebrow="Keep it out of sight, not out of the story" onClose={onClose} footer={<><button className="button-secondary" onClick={onClose}>Cancel</button><button form="snooze-form" className="button-primary">Save snooze <Check size={16} /></button></>}><form id="snooze-form" className="form-stack" onSubmit={submit} noValidate><p className="sheet-intro">DueWeave records the pause in the private timeline. It never sends anything for you.</p><Field label="Bring this back on" error={dateError}><input className={inputClass} data-autofocus type="date" min={todayInIndia()} value={until} onChange={(event) => { setUntil(event.target.value); setDateError(""); }} required aria-invalid={Boolean(dateError)} /></Field></form></Sheet>;
}
