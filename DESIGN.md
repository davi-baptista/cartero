---
name: Cartero
description: Personal financial ledger — precise, dark, zero decoration
colors:
  background: "oklch(0.145 0 0)"
  surface: "oklch(0.205 0 0)"
  surface-muted: "oklch(0.269 0 0)"
  foreground: "oklch(0.985 0 0)"
  foreground-muted: "oklch(0.708 0 0)"
  primary: "oklch(0.640 0.210 272)"
  primary-foreground: "oklch(0.985 0 0)"
  destructive: "oklch(0.704 0.191 22.216)"
  positive: "oklch(0.600 0.150 145)"
  status-open: "oklch(0.600 0.170 220)"
  status-closed: "oklch(0.720 0.150 60)"
  border: "oklch(1 0 0 / 10%)"
  input-bg: "oklch(1 0 0 / 5%)"
typography:
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
  mono:
    fontFamily: "Geist Mono, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "oklch(0.640 0.210 272 / 80%)"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-destructive:
    backgroundColor: "oklch(0.704 0.191 22.216 / 20%)"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "16px"
  input:
    backgroundColor: "{colors.input-bg}"
    rounded: "{rounded.lg}"
    height: "32px"
  badge-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.full}"
  badge-destructive:
    backgroundColor: "oklch(0.704 0.191 22.216 / 20%)"
    textColor: "{colors.destructive}"
    rounded: "{rounded.full}"
  badge-status-open:
    backgroundColor: "oklch(0.600 0.170 220 / 15%)"
    textColor: "{colors.status-open}"
    rounded: "{rounded.full}"
  badge-status-closed:
    backgroundColor: "oklch(0.720 0.150 60 / 15%)"
    textColor: "{colors.status-closed}"
    rounded: "{rounded.full}"
  badge-positive:
    backgroundColor: "oklch(0.600 0.150 145 / 15%)"
    textColor: "{colors.positive}"
    rounded: "{rounded.full}"
---

# Design System: Cartero

## 1. Overview

**Creative North Star: "The Precision Ledger"**

Cartero is a personal financial workspace that disappears into the task. The surface is always dark, always spare. Confidence comes from correctness, not decoration: every amount is formatted, every state is labeled, every action is unambiguous. The interface is built for a single person who already trusts themselves with their money and needs a tool that stops talking and starts working.

This system rejects the entire visual language of consumer finance apps. No green money gradients. No warm cream backgrounds whispering "trust us." No gamified pie charts with bouncing transitions. No purple "growth" branding borrowed from neobanks that need to convince you they're legitimate. Cartero is a private ledger — the kind you keep because you care about accuracy, not because a startup asked you to track your coffee spending.

What remains after stripping everything decorative: Geist Sans in a tight, fixed scale; near-black surfaces separated by barely-there borders; and a single Confident Indigo accent (`oklch(0.640 0.210 272)`) that appears only where something needs to be done or is currently active. Every other pixel is gray.

**Key Characteristics:**
- Dark-native: every contrast ratio, tonal step, and color decision is calibrated for dark backgrounds; no light-mode adaptations exist
- Signal over noise: the violet accent is rare enough that its presence carries meaning — active state, primary action, focus
- Numbers first: monetary amounts receive visual priority — larger size, higher weight, formatted as R$ currency
- Row-level density: lists render as rows with `border-b` separators, not individual cards — more data, less chrome
- Semantic color vocabulary: income green marks receipts, ledger red marks losses and overdue states, confident indigo marks decisions, gray marks history

## 2. Colors: The Near-Achromatic Dark

A near-achromatic dark system with a single accent. All eleven color tokens serve specific semantic roles; none are decorative.

### Primary
- **Confident Indigo** (`oklch(0.640 0.210 272)`): the only saturated color in the system. Applied to primary buttons, active navigation items, focus rings, and interactive state indicators. White text on it always (saturated mid-luminance rule). Never used for passive UI, never doubled as a background tint without specific semantic intent.

### Neutral
- **Near-Void** (`oklch(0.145 0 0)`): the base layer. Every screen. The darkest surface the user ever sees in normal use.
- **Elevated Surface** (`oklch(0.205 0 0)`): cards, popovers, dialogs, the sidebar. One tonal step above Near-Void.
- **Receded Surface** (`oklch(0.269 0 0)`): muted backgrounds, hover fills for ghost elements, secondary area fills. A third tonal step.
- **Ledger White** (`oklch(0.985 0 0)`): primary text, icon fills, high-emphasis labels.
- **Subdued Ink** (`oklch(0.708 0 0)`): secondary text, dates, category labels, metadata. Minimum 4.5:1 against Near-Void (verified: ~4.8:1).
- **Hairline** (`oklch(1 0 0 / 10%)`): all borders, separators, card ring outlines. Never opaque.
- **Input Surface** (`oklch(1 0 0 / 5%)`): text field backgrounds. Near-invisible fill that gives inputs a distinct hit area.

### Semantic
- **Ledger Red** (`oklch(0.704 0.191 22.216)`): destructive actions, negative amounts, OVERDUE invoice status, validation errors. Used at 20% opacity for badge fills.
- **Income Green** (`oklch(0.600 0.150 145)`): INCOME transaction type, PAID invoice status, positive amounts. Used at 15% opacity for badge fills.
- **Open Blue** (`oklch(0.600 0.170 220)`): OPEN invoice status only. Used at 15% opacity for badge fill, full for text.
- **Closure Amber** (`oklch(0.720 0.150 60)`): CLOSED invoice status only. Used at 15% opacity for badge fill, full for text.

### Named Rules
**The One Voice Rule.** Confident Indigo appears on ≤10% of any given screen. Its rarity is the point — it marks the singular action or active state. Adding it to a second element on the same screen dilutes the signal to zero.

**The No-Warm-Background Rule.** The background is always pure neutral — no chroma, no warmth. `oklch(0.145 0 0)`, not `oklch(0.145 0.008 50)`. The indigo accent provides all identity; warming the background is the AI cream-and-beige trap.

## 3. Typography

**UI Font:** Inter (Google Fonts, `--font-inter`) — humanist sans, industry standard for product UI, exceptional numerical rendering.
**Data Font:** Geist Mono (`--font-geist-mono`) — reserved for transaction IDs, invoice references, and raw date strings where column alignment matters.

**Character:** Inter carries all UI text. It has more optical weight than geometric alternatives at the same declared size — the right choice for dark surfaces where thin strokes read as fragile. Numbers render with optical balance at all sizes. No display/body pairing needed; this is a tool, not an editorial.

### Hierarchy
- **Headline** (600 weight, 24px/1.5rem, -0.01em tracking, 1.3 line-height): page titles only. One per screen. Appears at the top of each route (`Transações`, `Bancos`, `Faturas`).
- **Title** (500 weight, 16px/1rem, 1.4 line-height): section headings, card titles, sheet titles. Appears frequently; stays compact.
- **Body** (400 weight, 14px/0.875rem, 1.5 line-height): all list content, description text, form field values. The dominant size on most screens.
- **Label** (500 weight, 12px/0.75rem, +0.01em tracking, 1.4 line-height): form labels, table column headers, badge text, metadata chips. Uppercase only for column headers.
- **Mono** (400 weight, Geist Mono, 14px, 1.5 line-height): numeric amounts in transaction rows where alignment across rows matters, invoice IDs.

### Named Rules
**The Amount Rule.** Monetary amounts always render as R$ formatted (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`). Positive amounts in Income Green; negative/expense amounts in Ledger Red; neutral/historical amounts in Ledger White. Never raw decimal strings.

**The Fixed Scale Rule.** No `clamp()`, no fluid typography. This is a product UI viewed at consistent viewport widths; font sizes are fixed rem values across breakpoints.

## 4. Elevation

No shadows anywhere in the system. Depth is communicated entirely through tonal layering — a three-step ramp from Near-Void to Elevated Surface to Receded Surface. Layers are further separated by Hairline borders at 10% opacity white. The result is a surface hierarchy that reads cleanly at any brightness without the dated look of drop shadows.

Cards and panels rise one tonal step above the base (Near-Void → Elevated Surface). The sidebar sits at the Elevated Surface layer. Modal backdrops darken the base to `oklch(0 0 0 / 60%)` with a `blur(4px)` backdrop-filter on the modal surface — the only instance of a shadow-adjacent effect, and it's structural, not decorative.

**The Flat-By-Design Rule.** No `box-shadow` in the interface. No `drop-shadow`. No blurs for decoration. If a surface needs to feel "in front," lighten it by one tonal step. If the problem can't be solved by tonal layering, the layout needs to change, not the shadow budget.

## 5. Components

Components follow the shadcn/ui base-nova vocabulary — restrained, compact, no decoration. The feel is "precise and purposeful." Every interactive component has a defined default, hover, focus, active, disabled, and error state.

### Buttons
- **Shape:** Gently curved (10px radius, `rounded-lg`). Not pill, not sharp — a considered mid-point.
- **Primary:** Confident Indigo fill (`oklch(0.640 0.210 272)`), white text, 32px tall, 10px horizontal padding. The single most prominent action on any screen.
- **Hover:** Indigo at 80% opacity. No scale, no lift — state change, not drama.
- **Focus:** Indigo border + 3px ring at 50% opacity. Keyboard navigation remains unambiguous.
- **Active (press):** 1px Y-translation down. Tactile feedback without animation.
- **Disabled:** 50% opacity, pointer-events none.
- **Outline:** Transparent fill, `border-input` border. Secondary actions alongside a primary.
- **Ghost:** No fill, no border. Navigation-adjacent actions, icon-only buttons.
- **Destructive:** Ledger Red at 20% fill, Ledger Red text. Confirm-delete scenarios only.
- **Size default:** 32px tall (`h-8`). Compact but comfortable. Icon-only buttons are 32×32px.

### Chips
Used for transaction type filters and status filters in `FilterBar`.
- **Unselected:** Ghost variant — no fill, Subdued Ink text, outline border.
- **Selected:** Indigo at 15% fill, Confident Indigo text, no border. Selection is visible at a glance.

### Cards / Containers
Used for auth screens, invoice summaries, and bank overview panels. Transaction lists and debt lists use row layouts, not individual cards.
- **Corner Style:** Gently rounded (14px radius, `rounded-xl`).
- **Background:** Elevated Surface (`oklch(0.205 0 0)`).
- **Border:** `ring-1 ring-foreground/10` — Hairline ring, no drop shadow.
- **Padding:** 16px all sides (`p-4`). Compact sections use 12px.
- **Card footer:** Receded Surface (`oklch(0.269 0 0 / 50%)`) fill, `border-t` hairline separator.

### Inputs / Fields
- **Style:** Transparent background (Input Surface at 5% fill in dark), 10px radius, `border-input` border.
- **Focus:** Indigo border (`border-ring`) + 3px ring at 50% opacity. No glow effect; focus is signaled by the ring only.
- **Error state:** `aria-invalid` triggers Ledger Red border + Ledger Red ring at 20% opacity.
- **Disabled:** Input Surface at 50% fill, 50% opacity, `cursor-not-allowed`.
- **Placeholder:** Subdued Ink — passes WCAG AA at 4.8:1 against Near-Void.
- **Height:** 32px (`h-8`). Compact, consistent with button height for inline form/action pairings.

### Navigation — Sidebar
Collapsible left sidebar using shadcn/ui `Sidebar` primitive with `SidebarRail`.
- **Default state:** Items render as ghost buttons — no fill, Subdued Ink icon and text.
- **Hover:** Receded Surface fill (`oklch(0.269 0 0 / 50%)`), Ledger White text.
- **Active (current route):** Indigo tint fill (`oklch(0.640 0.210 272 / 15%)`), Confident Indigo text and icon. Active state is unmistakable.
- **Footer:** Avatar initials + truncated name and email in Subdued Ink + ghost LogOut icon button.
- **Collapsed:** Rail (4px strip) remains visible; icon-only mode when narrowed.

### InvoiceStatusBadge (Signature Component)
The most frequently seen badge in the system. Four possible states; each must be visually distinct at a glance.
- **OPEN:** Open Blue tint bg (`oklch(0.600 0.170 220 / 15%)`), Open Blue text.
- **CLOSED:** Closure Amber tint bg (`oklch(0.720 0.150 60 / 15%)`), Closure Amber text.
- **OVERDUE:** Ledger Red tint bg (`oklch(0.704 0.191 22 / 15%)`), Ledger Red text.
- **PAID:** Income Green tint bg (`oklch(0.600 0.150 145 / 15%)`), Income Green text.
- **Shape:** Full pill (`rounded-4xl`), 20px tall, 8px horizontal padding, 12px label text, 500 weight.

### AmountDisplay (Signature Component)
Every monetary value in the interface goes through this treatment.
- R$ formatted via `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
- Positive/income amounts: Income Green (`oklch(0.600 0.150 145)`).
- Negative/expense amounts: Ledger Red (`oklch(0.704 0.191 22.216)`).
- Neutral/historical amounts (e.g., invoice totals): Ledger White.
- Primary amount in a row: 500 weight, body size (14px). Summary amounts in invoice headers: headline size (24px), 600 weight.

## 6. Do's and Don'ts

### Do:
- **Do** use Confident Indigo (`oklch(0.640 0.210 272)`) exclusively for primary buttons, active navigation, and focus rings. Keep its surface coverage below 10% per screen.
- **Do** format all monetary amounts as `R$ 1.234,56` via `Intl.NumberFormat('pt-BR')`. Never render raw decimals in the UI.
- **Do** use row + `border-b` patterns for transaction lists, debt lists, and receivables lists. Cards are for containers, not list items.
- **Do** use Sheets (side panels) or Dialogs for create/edit flows. Never navigate to a new page for a form.
- **Do** render skeletons during loading — `<Skeleton />` on the exact shape of the incoming content.
- **Do** write empty states that teach: "Nenhuma transação encontrada. Crie a primeira usando o botão acima." Not "Nothing here."
- **Do** use Sonner toasts (`toast.success`, `toast.error`) for all user-facing action feedback. Top-right, rich colors.
- **Do** keep all text in Portuguese (pt-BR). No English labels, no English error messages in the UI.
- **Do** show action buttons (edit, delete) only on row hover — hidden by default to reduce visual noise.

### Don't:
- **Don't** use a warm-tinted background. Background is `oklch(0.145 0 0)` — pure neutral, zero chroma. The "modern and warm" trap is a near-white background with C > 0.005 toward yellow; it immediately reads as cream/beige.
- **Don't** add a light mode. The `dark` class is hardcoded on `<html>`; there is no toggle. Designing for light mode would require rebuilding the system from scratch.
- **Don't** use generic SaaS cream/beige aesthetics — warm neutral backgrounds, rounded-everything, soft pastels. This is the single most common AI generation trap; refuse it.
- **Don't** adopt fintech green (Nubank/Robinhood purple, Revolut teal, any money-green branding color) as the primary accent. Confident Indigo is the accent; green is reserved for income/positive semantic meaning only.
- **Don't** use banking blue (navy + gold). No corporate trust-signal palette. Cartero is a tool, not a financial institution.
- **Don't** gamify the interface — no bright category-color splashes, no playful card illustrations, no animated celebration states. The reference anti-pattern is Splitwise/Spendee.
- **Don't** use `box-shadow` or `drop-shadow`. Depth is tonal, not shadow-based.
- **Don't** apply the Confident Indigo to more than one distinct element per screen. If two things are both indigo, one is decorative.
- **Don't** use gradient text (`background-clip: text`). Never.
- **Don't** add border-left colored stripes as card accents. Use background tints or category icon colors instead.
- **Don't** show all action buttons inline in rows. Hover-reveal keeps the default state scannable.
