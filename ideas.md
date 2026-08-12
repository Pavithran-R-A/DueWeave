# DueWeave Stage 1 Design Brainstorm

## Three stylistic approaches

### Theme Name: Quiet Ledger
Very Brief Intro: A warm editorial operating surface for awkward money conversations: ink-like typography, bone canvas, sea-glass actions, and a precise queue that feels closer to a well-made field notebook than an accounting suite.
Probability: 0.06

### Theme Name: Signal Room
Very Brief Intro: A high-contrast command center with slate surfaces, amber warnings, and a strong left-rail rhythm that turns overdue work into an intentional daily briefing.
Probability: 0.08

### Theme Name: Soft Contract
Very Brief Intro: A human, tactile system built around promise cards, paper-like layers, and gentle coral/teal state markers that make renegotiation feel safe rather than adversarial.
Probability: 0.04

## Chosen direction: Quiet Ledger

### Design Movement
Contemporary editorial fintech: Swiss-inspired information discipline softened by tactile paper surfaces, Indian rupee-aware numerals, and a calm service-business tone.

### Core Principles
1. **One next action at a time.** Today is an operational briefing, not a dashboard collage; urgency is visible through scale, rhythm, and reason labels.
2. **History never disappears.** Promises and payments read as a chronological story, not a mutable spreadsheet row.
3. **Warm precision.** Money is exact, but the language around people stays factual, editable, and respectful.
4. **Quiet hierarchy.** Deep ink, paper canvas, thin rules, and restrained status colors create focus without visual alarmism.

### Color Philosophy
Use a warm bone canvas to keep the interface human and daylight-friendly, deep blue-black ink for confidence, sea-glass teal for action and kept states, and a muted marigold/coral pair for due and broken states. The colors should behave like editorial annotations rather than neon alerts. The signature brand color is **Kelp Teal #137B78**, a recognizable blend of calm and forward movement.

### Layout Paradigm
Use an editorial “briefing” composition: a narrow command rail on desktop, a strong summary line, an offset queue stack, and a selected-detail panel that opens like a desk note. On mobile, collapse the rail into bottom navigation and keep action reachable with one persistent Add button. Avoid a centered grid of equal cards; use asymmetry and varying density to tell the user what matters now.

### Signature Elements
1. A small woven-thread/anchor mark used as the app symbol and favicon.
2. “Reason strips” on queue items that surface the two strongest scoring facts.
3. Timeline dots connected by a thin thread, with broken promises shown as a coral interruption rather than a destructive deletion.

### Interaction Philosophy
Every interaction should reduce the emotional cost of follow-up. Use direct labels, editable messages, and explicit state changes. Primary actions have a crisp pressed state; secondary actions stay quiet. When a payment is recorded, show a measured confirmation and update the queue without confetti or theatrical motion.

### Animation
Use 160–220ms ease-out transitions for sheets, button presses, focus, and queue selection. Queue changes use a short opacity/translate transition rather than a bounce. Timeline state changes can briefly emphasize the new dot with a 1.02 scale. Respect `prefers-reduced-motion` and never animate money values continuously.

### Typography System
Use **DM Sans** for UI text and **Fraunces** for a few display moments on the public/empty-state surface. The product shell stays mostly DM Sans for small-text legibility and strong ₹ numerals; monetary figures use tabular numerals with clear weight. Display hierarchy: 12px uppercase eyebrow, 15px labels, 16–18px card titles, 28–44px summary money, and 48px maximum hero display on large screens.

### Brand Essence
DueWeave is the calm promise ledger for Indian freelancers and small service businesses who need to remember what a client said and know what deserves attention today. Personality: **steady, exact, humane**.

### Brand Voice
Headlines are concise and observant. CTAs are direct but never aggressive. Microcopy speaks about facts and next actions, not blame.

Example lines:
- “Your client promised Friday. Now you’ll remember.”
- “A clear next message, without making the conversation harder.”

### Wordmark & Logo
Use the generated DueWeave mark at `/manus-storage/dueweave-mark_e333309b.png`: a woven thread resolving into an anchor-like loop, paired with a compact wordmark set in DM Sans with a custom teal “weave” underline. The mark must also appear as the favicon and in the app rail.

### Signature Brand Color
**Kelp Teal — #137B78.** It owns the product’s action layer without looking like a generic bank green or a loud productivity blue.

## Style Decisions

- Keep the app light-first, with a deliberately designed dark mode rather than an automatic color inversion.
- Use generated texture only as a quiet supporting surface; do not make the product image-led.
- Prefer borders, tonal surfaces, and thin rules over heavy shadows.
- Never use a generic dashboard card wall, purple gradients, fake urgency, or debt-collector language.
- The DueWeave woven-thread/anchor mark is visible in the authenticated product chrome, including the desktop header and left rail.
- Desktop preserves a briefing rail / ledger spine; the top header supports the rail rather than replacing it.
- Priority reasons read as ledger annotations with a restrained rule and pin rather than generic rounded status chips.
