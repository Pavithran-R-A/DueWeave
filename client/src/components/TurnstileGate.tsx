import { useEffect, useRef } from "react";
import { loadTurnstile, TURNSTILE_SITE_KEY, type TurnstileApi, type TurnstileWindow } from "@/lib/turnstile";

type TurnstileGateProps = {
  // Bumped by the screen after every attempt. A Turnstile token is single-use, so a refused
  // sign-in has to hand the visitor a fresh one rather than replay the consumed value.
  attempt: number;
  onToken: (token: string) => void;
  onFailure: (message: string) => void;
};

/**
 * The browser half of Supabase's CAPTCHA setting. Rendered only when the build carries a site
 * key, because a widget with no key is a frame that can never produce a token — and the auth
 * call would then be refused by GoTrue for a reason the visitor cannot see or fix.
 */
export function TurnstileGate({ attempt, onToken, onFailure }: TurnstileGateProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const handlers = useRef({ onToken, onFailure });
  const api = useRef<TurnstileApi | null>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    handlers.current = { onToken, onFailure };
  }, [onToken, onFailure]);

  useEffect(() => {
    let cancelled = false;
    void loadTurnstile(document, window as TurnstileWindow)
      .then((turnstile) => {
        if (cancelled || !container.current || widget.current) return;
        api.current = turnstile;
        widget.current = turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => handlers.current.onToken(token),
          "expired-callback": () => handlers.current.onFailure("The verification expired. Complete it again."),
          "error-callback": () => handlers.current.onFailure("The verification service refused this request. Complete it again."),
          theme: "auto",
        });
      })
      .catch(() => {
        if (!cancelled) handlers.current.onFailure("DueWeave could not reach the verification service. Check your connection and try again.");
      });
    return () => {
      cancelled = true;
      if (api.current && widget.current) api.current.remove(widget.current);
      widget.current = null;
      api.current = null;
    };
  }, []);

  useEffect(() => {
    if (attempt === 0) return;
    if (api.current && widget.current) api.current.reset(widget.current);
  }, [attempt]);

  return <div className="turnstile-slot" ref={container} />;
}
