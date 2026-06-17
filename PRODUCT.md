# Product

## Register

product

## Users

Primary user: the developer themselves, managing personal finances daily. Power user who built the tool — familiar with financial concepts (faturas, parcelas, PIX, boletos), comfortable with dense information. Potentially expanded to other individuals in the future, but the baseline is a single person who trusts the interface because they built it.

Usage context: on a laptop, at a desk, at night or in a dimly lit room. Dark environment, focused session. Looking to log a transaction quickly, check what's left in a credit card invoice, or verify a debt due date.

Job to be done: get in, find or record the right financial data, get out. Minimize cognitive overhead. No hand-holding needed.

## Product Purpose

Cartero tracks personal finances across transactions, credit card invoices (faturas), external debts, and receivables. Its focus is on expense tracking and awareness — not balance management or investment advice.

Success means: the user opens the app, sees exactly where their money is going, logs something in under 30 seconds, and never wonders what state an invoice is in.

Not a banking app. Not a budgeting app in the mint.com sense. A precise personal ledger.

## Brand Personality

Moderno, elegante, minimalista — in the tradition of focused developer tools. Not warm or approachable; precise and confident. The tool disappears into the task.

Closest reference in spirit: Linear. Not Linear's exact aesthetic — but Linear's philosophy: opinionated defaults, zero decoration, information density that respects the user's intelligence.

## Anti-references

- **Generic SaaS cream/beige**: warm-neutral light bg, rounded-everything, soft pastels — the Framer/Webflow template default. Avoid.
- **Fintech green (Nubank/Robinhood/Revolut)**: heavy brand-color saturation, purple or money-green as a dominant surface, feels like a marketing landing page inside a product.
- **Banking blue (navy + gold)**: corporate trust-signal palette, dated, feels like an institution not a tool.
- **Gamified / colorful (Splitwise, Spendee)**: bright category icons, social-app energy, cheerful illustrations. Cartero is serious about your money.

## Design Principles

1. **Clarity over decoration** — every visual element earns its place by making financial data faster to scan. If a visual choice doesn't aid comprehension, remove it.
2. **Dark-native, not dark-adapted** — the interface was designed for dark mode from the start. Contrast, depth, and color are calibrated for dark surfaces, not ported from light mode.
3. **Data is first-class content** — monetary values, dates, invoice statuses, and transaction types are the primary content. Typography hierarchy and spacing serve them.
4. **Restraint as sophistication** — a minimal UI chrome means the product disappears into the task. Brand color appears only where it carries semantic meaning: primary actions, active states, status indicators.
5. **Earned density** — information is compact enough to scan without scrolling, airy enough that nothing feels cramped. Tables over cards where lists are long; cards only where spatial separation matters.

## Accessibility & Inclusion

- WCAG AA minimum; target AAA for body text on dark backgrounds (≥7:1 contrast ratio).
- No light mode toggle — dark-only is a deliberate product decision.
- All interactive states (hover, focus, active, disabled, loading, error) must be visually distinct without relying on color alone.
- Motion: prefer reduced-motion safe defaults; any animation must have a `prefers-reduced-motion` fallback.
- Portuguese (pt-BR) throughout; no English labels in the UI.
