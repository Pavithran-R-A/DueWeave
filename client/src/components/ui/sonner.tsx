import { Toaster as Sonner, toast, type ToasterProps } from "sonner";

// One lifetime policy for everything the app puts on screen: a success is
// confirmation and should leave the ledger quickly, while a refusal has to stay
// long enough to read and act on. Routing every call through `feedback` keeps that a
// single rule rather than a number repeated at fifty call sites, and keeps a toast
// from being the only place a reason exists — forms answer at the field instead.
const SUCCESS_TOAST_MS = 4_500;
const REFUSAL_TOAST_MS = 9_000;

type ToastTitle = Parameters<typeof toast.success>[0];
type ToastOptions = Parameters<typeof toast.success>[1];
type RefusalOptions = ToastOptions & { passthrough?: boolean };

// A refusal that points a person at a control on the page must not stand in front of
// that control. See the Stage 9 comment on `.toast--passthrough` in index.css.
const PASSTHROUGH_TOAST_CLASS = "toast--passthrough";

export const feedback = {
  success: (title: ToastTitle, options?: ToastOptions) => toast.success(title, { duration: SUCCESS_TOAST_MS, ...options }),
  info: (title: ToastTitle, options?: ToastOptions) => toast.info(title, { duration: SUCCESS_TOAST_MS, ...options }),
  message: (title: ToastTitle, options?: ToastOptions) => toast.message(title, { duration: SUCCESS_TOAST_MS, ...options }),
  error: (title: ToastTitle, { passthrough, ...options }: RefusalOptions = {}) => toast.error(title, { duration: REFUSAL_TOAST_MS, ...(passthrough ? { className: PASSTHROUGH_TOAST_CLASS } : {}), ...options }),
};

// Stage 6 found that a toast parked in the corner lands exactly on the header's
// primary action, which is the one button a person reaches for right after a save.
// The offsets put each toast below its header instead, measured against the real
// shell: the sticky header is 92px on desktop and 86px at 360px wide, so the toast
// rests at 108px and 96px. Neither the bottom navigation nor a sheet's confirm
// button is covered. Toasts stay interactive (queue and Founder actions carry real
// buttons), so nothing here disables pointer events — except a refusal that names a
// control below it, which opts into `passthrough` so that control keeps the hit test.
const Toaster = (props: ToasterProps) => {
  return <Sonner theme="light" className="toaster group" position="top-right" offset={{ top: 108, right: 28 }} mobileOffset={{ top: 96, left: 14, right: 14 }} visibleToasts={3} duration={SUCCESS_TOAST_MS} style={{ "--normal-bg": "var(--surface)", "--normal-text": "var(--ink)", "--normal-border": "var(--rule)" } as React.CSSProperties} {...props} />;
};

export { Toaster };
