// CL-7 item 12: the browser half of Supabase's CAPTCHA protection.
//
// The server half is a hosted GoTrue setting — enable CAPTCHA, hand GoTrue the Turnstile secret —
// and when it is on, GoTrue verifies the token itself and refuses every protected auth call that
// arrives without one. What this repository owns is the token: without it, turning that setting on
// would break sign-in, sign-up, recovery and resend rather than protect them, so the forwarding has
// to ship before the hosted setting is flipped, not after.
//
// A site key is a public value supplied by the Pages build environment, so an unset key means no
// script element, no Cloudflare origin contacted and no token collected. That is the state the
// flags-off production bundle is built in, and the release record may not describe CAPTCHA as
// enabled while it holds.

export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "dueweave-turnstile-script";

export type TurnstileRenderOptions = {
  sitekey: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
};

export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

export type TurnstileWindow = Window & { turnstile?: TurnstileApi };

export function resolveTurnstileSiteKey(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export const TURNSTILE_SITE_KEY = resolveTurnstileSiteKey(import.meta.env.VITE_TURNSTILE_SITE_KEY);

/** GoTrue reads the token from `options.captchaToken`; an absent token must be an absent field. */
export function captchaOptions(token: string | null | undefined): { captchaToken?: string } {
  const trimmed = (token ?? "").trim();
  return trimmed ? { captchaToken: trimmed } : {};
}

// One attempt per window: the auth screen mounts and unmounts its widget as the visitor switches
// between sign-in, sign-up and recovery, and a second element for the same API would be a second
// network round trip that resolves to the same object anyway. Keyed by the window rather than held
// in a module variable so the loader stays a function of its arguments.
const inFlight = new WeakMap<TurnstileWindow, Promise<TurnstileApi>>();

export function loadTurnstile(doc: Document, win: TurnstileWindow): Promise<TurnstileApi> {
  if (win.turnstile) return Promise.resolve(win.turnstile);
  const started = inFlight.get(win);
  if (started) return started;

  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = doc.querySelector<HTMLScriptElement>(`#${SCRIPT_ID}`) ?? doc.createElement("script");
    script.addEventListener("load", () => {
      if (win.turnstile) resolve(win.turnstile);
      else reject(new Error("Turnstile loaded without exposing its API."));
    });
    script.addEventListener("error", () => {
      // A failed element left in the head would be found by the next attempt's querySelector and
      // awaited forever, since a dead script fires no further events.
      script.remove();
      reject(new Error("Turnstile could not be loaded."));
    });
    if (!script.src) {
      script.id = SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_SRC;
      // Async because the auth screen is the first thing a locked-out customer needs; a render-blocking
      // third-party script would delay it for a widget that may never be configured.
      script.async = true;
      script.defer = true;
      doc.head.appendChild(script);
    }
  });

  inFlight.set(win, promise);
  promise.catch(() => {
    if (inFlight.get(win) === promise) inFlight.delete(win);
  });
  return promise;
}
