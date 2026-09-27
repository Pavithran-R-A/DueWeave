import type { Page, Request } from "@playwright/test";

// Stage 6 Phase 54: a screen can look right and still be failing underneath — a React
// key warning, an uncaught error after render, a request that never answered. These
// listeners turn that hidden traffic into assertions, read from the browser's own
// events rather than from anything the app chooses to log.

export interface ProblemWatch {
  consoleErrors: string[];
  pageErrors: string[];
  unansweredRequests: string[];
}

export function startProblemWatch(page: Page): ProblemWatch {
  const watch: ProblemWatch = { consoleErrors: [], pageErrors: [], unansweredRequests: [] };
  const answered = new Set<Request>();
  page.on("console", (message) => {
    if (message.type() === "error") watch.consoleErrors.push(`console: ${message.text()} [${message.location().url || "no source"}]`);
  });
  page.on("pageerror", (error) => watch.pageErrors.push(`uncaught: ${error.message}`));
  page.on("response", (response) => answered.add(response.request()));
  // Chromium reports a request as aborted when the caller stops reading a body it
  // never needed — measured here on the 204 answer to `POST /auth/v1/logout`, which
  // fires both events on the same request. A server answer is the evidence that
  // matters, so only a request that never got one counts as a failed journey.
  page.on("requestfailed", (request) => {
    if (answered.has(request)) return;
    watch.unansweredRequests.push(`request: ${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "no response"}`);
  });
  return watch;
}

/**
 * The problems a journey left behind. `expectedFailures` names requests this test
 * deliberately breaks — an aborted write is the point of the case, not a surprise —
 * and nothing else is excused. A broken request also prints a console line, so the
 * allowance applies to both channels; each console entry carries the URL of the
 * resource that produced it, which keeps the allowance per-request instead of a
 * blanket mute. An uncaught error is never excused: it outlives the request that
 * started it and means the render itself broke.
 */
export function problemsFound(watch: ProblemWatch, expectedFailures?: RegExp): string[] {
  const unexpected = (entries: string[]) => (expectedFailures ? entries.filter((entry) => !expectedFailures.test(entry)) : entries);
  return [...unexpected(watch.consoleErrors), ...watch.pageErrors, ...unexpected(watch.unansweredRequests)];
}
