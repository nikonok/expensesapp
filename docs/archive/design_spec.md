# Design Specification — Expenses App

**Aesthetic:** Cyberpunk / Dark — calibrated to Revolut-level restraint (precise, premium, not garish)
**Mood:** Precise · Electric · Confident
**Platform priority:** Mobile Android (PWA) → Desktop browser
**Influence:** Revolut dark — numbers dominate, surfaces are minimal, color is earned not sprayed
**Browser target:** Chrome 115+, Safari 16.4+, Firefox 128+. No oklch() fallbacks needed.

> **Note on CSS tokens in specs below:** all `--token` references in component descriptions imply `var(--token)` in implementation.

---

## Design Philosophy

Numbers are the hero. Every screen exists to make financial data instantly readable. The visual language is dark, high-contrast, and uncompromising — neon on near-black, monospace amounts, sharp geometry. Glows are accents, not atmosphere. If every element glows, nothing glows.

**Key differentiator:** Financial amounts render in monospace with semantic color + a _subtle_ glow. Account/category colors are structural — they tint icons and borders to create identity, not decoration. Everything else is restrained.

---

## Typography

| Role                  | Font                                                               | Weight    |
| --------------------- | ------------------------------------------------------------------ | --------- |
| Headings / Tab titles | [Syne](https://fonts.google.com/specimen/Syne)                     | 700       |
| UI labels / body      | [DM Sans](https://fonts.google.com/specimen/DM+Sans)               | 400 / 500 |
| All amounts / numbers | [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | 500 / 600 |

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Syne:wght@700&family=DM+Sans:opsz,wght@9..40,400;9..40,500&family=JetBrains+Mono:wght@500;600&display=swap"
/>
```

Fonts must be pre-cached by the service worker (vite-plugin-pwa `runtimeCaching` for `fonts.gstatic.com`) so the app renders correctly offline.

### Type Scale

```css
--text-display: clamp(2rem, 6vw, 3.5rem) /* large balance totals */ --text-heading: 1.25rem
  /* tab titles, section headers */ --text-subheading: 1.0625rem /* settings section headers */
  --text-day-num: 1.5rem /* day header day number (Syne 700) */ --text-body: 0.9375rem
  /* list items, labels */ --text-caption: 0.75rem /* secondary info, timestamps */
  --text-amount-lg: clamp(1.75rem, 5vw, 2.5rem) /* account balance hero */
  --text-amount-md: 1.125rem /* transaction row amounts */ --text-amount-sm: 0.875rem
  /* secondary amounts */;
```

Rule: all amounts → JetBrains Mono. All section headings → Syne. Everything else → DM Sans.

---

## Color System

Dark theme only. `oklch()` throughout.

```css
/* Backgrounds */
--color-bg: oklch(8% 0.02 265); /* #0A0B12 */
--color-surface: oklch(13% 0.025 265); /* #12151F */
--color-surface-raised: oklch(17% 0.03 265); /* #181C28 */
--color-border: oklch(22% 0.04 265);
--color-border-strong: oklch(35% 0.06 265);

/* Primary accent — electric cyan */
--color-primary: oklch(72% 0.22 210);
--color-primary-dim: oklch(72% 0.22 210 / 15%);

/* Semantic */
--color-income: oklch(73% 0.23 160); /* neon green */
--color-income-dim: oklch(73% 0.23 160 / 12%);
--color-expense: oklch(62% 0.28 18); /* hot red-magenta */
--color-expense-dim: oklch(62% 0.28 18 / 12%);
--color-transfer: oklch(60% 0.1 265); /* blue-gray */

/* Text */
--color-text: oklch(94% 0.01 265);
--color-text-secondary: oklch(55% 0.04 265);
--color-text-disabled: oklch(38% 0.03 265);
```

### Account/Category Color Palette — 24 swatches

Used as: icon background tint (20% opacity via `color-mix`), card left-border accent, glow color. Never as full-surface fill.

```css
/* Reds / Pinks */
--swatch-1: oklch(65% 0.22 0); /* true red */
--swatch-2: oklch(65% 0.22 10); /* warm red */
--swatch-3: oklch(65% 0.22 340); /* pink-red */
--swatch-4: oklch(65% 0.22 355); /* cool red */

/* Oranges */
--swatch-5: oklch(65% 0.22 30); /* orange */
--swatch-6: oklch(65% 0.22 45); /* amber */
--swatch-7: oklch(65% 0.22 60); /* yellow-orange */

/* Yellows */
--swatch-8: oklch(65% 0.22 75); /* gold */
--swatch-9: oklch(65% 0.22 90); /* yellow */
--swatch-10: oklch(65% 0.22 100); /* lime-yellow */

/* Greens */
--swatch-11: oklch(65% 0.22 130); /* lime */
--swatch-12: oklch(65% 0.22 150); /* green */
--swatch-13: oklch(65% 0.22 165); /* teal-green */

/* Blues / Cyans */
--swatch-14: oklch(65% 0.22 180); /* cyan */
--swatch-15: oklch(65% 0.22 200); /* sky */
--swatch-16: oklch(65% 0.22 220); /* blue */
--swatch-17: oklch(65% 0.22 240); /* deep blue */

/* Purples */
--swatch-18: oklch(65% 0.22 270); /* blue-purple */
--swatch-19: oklch(65% 0.22 290); /* purple */
--swatch-20: oklch(65% 0.22 310); /* magenta-purple */

/* Neutrals (lower chroma) */
--swatch-21: oklch(65% 0.08 30); /* warm brown */
--swatch-22: oklch(65% 0.06 60); /* sand */
--swatch-23: oklch(65% 0.04 265); /* cool gray */
--swatch-24: oklch(48% 0.03 265); /* dark slate */
```

---

## Spacing

Base: 4px.

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-12: 48px;
```

No magic numbers outside this scale.

---

## Layout

- Mobile max content width: **480px**, centered on desktop, `--color-bg` flanking.
- Safe areas: `env(safe-area-inset-*)` on bottom nav and top bar.

```css
html,
body {
  overscroll-behavior: none; /* prevent pull-to-refresh on both Chrome and Safari */
}
.scroll-container {
  overscroll-behavior: contain;
}
```

---

## Border Radius

| Component                  | Radius |
| -------------------------- | ------ |
| Cards, panels              | 12px   |
| Buttons                    | 8px    |
| Chips / filter pills       | 6px    |
| Icon badges                | 10px   |
| Input fields               | 8px    |
| Bottom sheet (top corners) | 20px   |
| Numpad keys                | 10px   |
| Tooltips                   | 6px    |
| Avatar/icon circles        | 9999px |

---

## Z-Index Scale

```css
--z-sticky: 10; /* sticky day headers */
--z-fab: 50; /* floating action button */
--z-nav: 100; /* bottom navigation bar */
--z-overlay: 200; /* backdrop behind sheets/modals */
--z-sheet: 300; /* bottom sheets, modals */
--z-toast: 400; /* toasts, snackbars */
```

---

## Glow Effects

Subtle. When in doubt, skip the glow.

```css
/* Income amount */
text-shadow: 0 0 12px oklch(73% 0.23 160 / 45%);

/* Expense amount */
text-shadow: 0 0 12px oklch(62% 0.28 18 / 45%);

/* Card border accent — use color-mix() to apply alpha to a CSS variable */
box-shadow:
  inset 3px 0 0 var(--card-color),
  0 0 8px color-mix(in oklch, var(--card-color) 15%, transparent);

/* Active bottom-nav icon */
filter: drop-shadow(0 0 5px var(--color-primary));

/* Primary button */
box-shadow: 0 4px 16px oklch(72% 0.22 210 / 30%);
```

---

## Animatable Card Color

Register `--card-color` as a typed CSS property so color transitions animate smoothly when the user changes an account/category color:

```css
@property --card-color {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(65% 0.22 210);
}
```

---

## Skeleton / Loading State

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-surface-raised) 0%,
    oklch(22% 0.04 265) 50%,
    var(--color-surface-raised) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
  border-radius: inherit;
}

@keyframes shimmer {
  0% {
    background-position: 200% center;
  }
  100% {
    background-position: -200% center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
    opacity: 0.7;
  }
}
```

Apply the `.skeleton` class to placeholder blocks. Match the shape of the content they replace (circle for icons, bars for text).

---

## Component Specs

### Bottom Navigation Bar

- 5 tabs: Accounts · Categories · Transactions · Budget · Overview
- Height: `calc(64px + env(safe-area-inset-bottom))`
- Background: `var(--color-surface)` + `backdrop-filter: blur(20px)` + `border-top: 1px solid var(--color-border)`
- Active tab: icon + label, `var(--color-primary)` + glow, animated 2px indicator line at top (slides between tabs, 150ms ease-out)
- Inactive: icon only (label hidden), `var(--color-text-disabled)`
- Touch target: full column width × full height

**Required icon assignments** (Lucide, label for inactive SR users via `aria-label`):

| Tab          | Icon               | Rationale                 |
| ------------ | ------------------ | ------------------------- |
| Accounts     | `wallet`           | universal                 |
| Categories   | `tag`              | semi-clear                |
| Transactions | `arrow-left-right` | clear                     |
| Budget       | `target`           | abstract — label required |
| Overview     | `layout-dashboard` | abstract — label required |

### Top App Bar

- Height: 56px
- Left: Settings gear (`settings` icon, opens Settings full-screen push)
- Center: tab title, Syne 700, `--text-heading`
- Right: contextual action per tab (trash, filter)
- Border: appears on scroll via CSS scroll-driven animation (no JS listener needed):

```css
@keyframes show-border {
  from {
    border-bottom-color: transparent;
  }
  to {
    border-bottom-color: var(--color-border);
  }
}
.app-bar {
  animation: show-border linear;
  animation-timeline: scroll(nearest block);
  animation-range: 0px 1px;
}
```

### Floating Action Button (FAB)

Visible on: **Transactions tab** and **Accounts tab** only.

```
Size: 56×56px, circle (border-radius: 9999px)
Position: fixed, bottom: calc(var(--nav-height) + 16px), right: 16px
           where --nav-height = 64px + env(safe-area-inset-bottom)
Background: var(--color-primary)
Icon: plus, 24px, var(--color-bg)
Shadow: 0 4px 16px oklch(72% 0.22 210 / 30%)
z-index: var(--z-fab)
Press: scale(0.92), 80ms ease-out
```

### Account Card

```
┌─[3px --card-color border-left]────────────────────┐
│  [36px icon circle]  Account Name    [type chip]   │
│                             1 240.00 PLN           │
└────────────────────────────────────────────────────┘
```

- `border-left: 3px solid var(--card-color)`
- Icon circle: `background: color-mix(in oklch, var(--card-color) 20%, transparent)`, icon in `var(--card-color)`
- Balance: `--text-amount-md`, JetBrains Mono, `var(--color-text)`
- Debt accounts: balance in `var(--color-expense)` with expense glow
- Type chip: `--text-caption`, `var(--color-text-secondary)`, 6px radius, `var(--color-surface-raised)` bg
- Tap: `scale(0.98)` 80ms ease-out → opens account detail sheet
- Skeleton: icon circle + name bar (60% width) + amount bar (40% width), shimmer pattern

### Total Wealth Table (Accounts Tab)

Appears above the account list. Rows grouped by currency.

```
          ASSETS        DEBTS
PLN      13 000        50 000
USD           5             0
```

- Currency code: JetBrains Mono, `--text-body`, `var(--color-text-secondary)`, left-aligned
- Asset amounts: `--text-amount-md`, JetBrains Mono, `var(--color-income)`
- Debt amounts: `--text-amount-md`, JetBrains Mono, `var(--color-expense)`
- Zero values: `var(--color-text-disabled)`
- Row: `border-bottom: 1px solid var(--color-border)`, 44px min-height
- Column headers: `--text-caption`, `var(--color-text-secondary)`, uppercase

### Transaction Row

```
[32px icon]  Category Name           +320.00
             Note text                   PLN
─────────── Day Header ──────────────────────
[32px icon]  Category Name            −45.50
```

- Row min-height: 60px, padding: `--space-3` vertical, `--space-4` horizontal
- Amount: right-aligned, JetBrains Mono `--text-amount-md`, `var(--color-income)` / `var(--color-expense)` + glow
- Amount always prefixed `+` or `−` (sign by color AND symbol)
- Note: `--text-caption`, `var(--color-text-secondary)`, 1 line max, ellipsis overflow
- Transfer row: `opacity: 0.5`, `var(--color-transfer)` amount, no glow
- Selected state: `background: var(--color-primary-dim)`, checkbox appears left (24px circle, `var(--color-primary)` fill)
- Skeleton: icon circle + two bars (60% and 30% width), shimmer

**Day header:**

- Sticky: `position: sticky; top: var(--sticky-offset, 56px); z-index: var(--z-sticky); background: var(--color-bg)`
- `--sticky-offset` must be set dynamically = app bar height + visible filter bar height (update via ResizeObserver)
- Left: day number `--text-day-num` Syne 700 + weekday+month `--text-caption` `var(--color-text-secondary)`
- Right: income total (`var(--color-income)`) + expense total (`var(--color-expense)`), `--text-amount-sm` JetBrains Mono

**Performance:** Wrap each day group in `content-visibility: auto; contain-intrinsic-size: auto 200px` for native list virtualization on long transaction histories.

**Drag-to-reorder:**

- Handle: `grip-vertical` Lucide icon, 16px, `var(--color-text-disabled)`, right side of row. The grip handle is the **sole drag initiator** — tapping anywhere else on the row triggers selection mode, not drag. The handle must have a distinct touch target (min 44×44px) that does not overlap the row's tap-to-select area.
- Active drag: `scale(1.03)`, `box-shadow: 0 8px 24px rgba(0,0,0,0.5)`, `opacity: 0.95`, `z-index: var(--z-sheet)`
- Drop target: 2px line in `var(--color-primary)` between rows

### Selection Toolbar (Transactions Tab)

Replaces bottom nav when ≥1 transaction is selected. Slides up from bottom.

```
Height: calc(56px + env(safe-area-inset-bottom))
Position: fixed, bottom: 0, full content width
Background: var(--color-surface-raised), border-top: 1px solid var(--color-border-strong)
z-index: var(--z-nav)
Animation: translateY(100%) → translateY(0), 200ms ease-out
           Bottom nav: translateY(0) → translateY(100%), simultaneous
```

- Single selected: **Edit** button (secondary) + **Remove** button (destructive), centered with `--space-4` gap
- Multiple selected: **Remove** button only (destructive), centered
- Dismiss: deselect all items or tap outside list

### Category Card (Categories Tab)

```
┌─[--card-color border-left]──────────────────────────┐
│  [icon]  Category Name                              │
│          Budget: 500 PLN     Spent: 320 PLN         │
│  [████████░░░░░░░░░] (progress bar, full width)     │
└──────────────────────────────────────────────────────┘
```

- Progress bar: 4px height, flush card bottom, `var(--card-color)` fill, `var(--color-border)` track
- Over-budget: fill → `var(--color-expense)`, card background → `var(--color-expense-dim)`
- No budget set: no progress bar, planned amount shows "—"

**Drag-to-reorder (edit mode):** Same visual spec as Transaction Row drag-to-reorder above.

### Donut Chart

- SVG, stroke-based (not filled), stroke-width = 10% of radius
- Gap between slices: 2px `var(--color-bg)` stroke
- Center: expense total (Syne `--text-heading` `var(--color-expense)`) / income total (`var(--color-income)`)
- On load: strokes draw in 400ms, staggered 40ms per slice, ease-out
- Tap/hover on slice: `filter: brightness(1.3)` + glow on active slice, others → `opacity: 0.35`
- **Tap target: entire SVG element** toggles category list between expense/income view
- No chart legend — category cards below serve as legend

### Period Filter

Appears at top of Categories, Transactions, Overview, and Budget tabs.

```
[This month ▾]  [<]  [>]
```

- Chip: 36px height, `var(--color-surface)` bg, `var(--color-border)` border, 6px radius
- Label: DM Sans 500 `--text-body`, `var(--color-text)`, trailing `▾` chevron
- Active custom range: `var(--color-primary-dim)` bg, `var(--color-primary)` border
- `<` / `>` navigation arrows: 32×32px, appear adjacent to chip only when a time-navigable period is selected (today / week / month / year)
- Tap chip → opens bottom sheet with period options as a radio list

### Bar Chart (Overview)

- Bar: `var(--color-primary)` at 70% opacity, 4px top-corner radius only
- Hovered/active bar: full `var(--color-primary)` + primary glow
- Grid: horizontal only, `var(--color-border)` at 50% opacity
- Axis labels: `--text-caption`, `var(--color-text-secondary)`
- Empty bars (zero): 2px stub, `var(--color-border)`
- Animation on mount: bars grow from 0 height, 300ms staggered ease-out

### Bottom Sheet / Modal

- Open: `translateY(100%) → translateY(0)`, 300ms `cubic-bezier(0.32, 0.72, 0, 1)`
- Close: 220ms ease-in
- Drag handle: 36×4px pill, `var(--color-border-strong)`, 12px from top, centered
- Background: `var(--color-surface-raised)`, top-corners 20px radius
- Backdrop: `rgba(0,0,0,0.7)` + `backdrop-filter: blur(4px)`, 200ms fade
- Dismiss: swipe down ≥ 40% sheet height OR tap backdrop
- Android soft keyboard: listen to `visualViewport` resize; translate sheet up to keep focused inputs visible. Do not resize the sheet.
- `z-index: var(--z-overlay)` on backdrop, `z-index: var(--z-sheet)` on panel

### Transaction Input (Numpad)

**Income / Expense layout:**

```
┌──────────────────────────────────────────────────┐
│  From [Account ▾]   →   To [Category ▾]          │
│                   320.00 PLN  (--text-amount-lg)  │
│              ≈ 76.00 EUR      (caption, mono)     │
│  Note: ___________________________               │
│  [Use last note ×]                               │
├─────┬───────────────────────────────────────────┤
│  +  │  7  │  8  │  9  │  ⌫                     │
│  −  │  4  │  5  │  6  │  📅                     │
│  ×  │  1  │  2  │  3  │ ╔══════════╗            │
│  ÷  │     │  0  │  .  │ ║  SAVE   ║            │
│     │     │     │     │ ╚══════════╝            │
└─────┴─────────────────┴───────────────────────-─┘
```

**Transfer layout:**

```
┌──────────────────────────────────────────────────┐
│  From [Account ▾]   →   To [Account ▾]           │
│                   320.00 PLN  (--text-amount-lg)  │
│  Note: ___________________________               │
├──────────────────────────────────────────────────┤
│  (operator column hidden for transfers)           │
│     7  │  8  │  9  │  ⌫                         │
│     4  │  5  │  6  │  📅                         │
│     1  │  2  │  3  │ ╔══════════╗                │
│        │  0  │  .  │ ║  SAVE   ║                │
└────────────────────┴─╚══════════╝───────────────-┘
```

- Key min-height: 60px, 10px radius
- Digit/decimal keys: `var(--color-surface)` bg, `var(--color-border)` border, `var(--color-text)`
- Operator keys: `var(--color-surface-raised)` bg, `var(--color-text-secondary)` text
- Backspace / Calendar: `var(--color-surface-raised)`, icon only
- Save: spans 2 rows height, `var(--color-primary)` bg, Syne 700, `var(--color-bg)` text, primary glow
- Key press: `scale(0.93)` + `filter: brightness(1.25)`, 80ms ease-out
- Trailing operator on Save: silently ignored; expression evaluated PEMDAS
- Result rounded to 2 decimal places

### Input Fields

- Background: `var(--color-surface-raised)`
- Border: `1px solid var(--color-border)`
- Focus: `outline: 2px solid var(--color-primary); outline-offset: 2px` (WCAG 2.2 SC 2.4.11 compliant) + decorative `box-shadow: 0 0 0 4px var(--color-primary-dim)`
- Label: `--text-caption`, `var(--color-text-secondary)`, above field
- Character counter: `--text-caption`, right-aligned below; turns `var(--color-expense)` when ≤ 10% chars remain
- Error: `border-color: var(--color-expense)`, message below in `var(--color-expense)` `--text-caption`
- Min tap target: 44px height
- Amount fields: `inputmode="decimal"` for correct Android keyboard

### Buttons

| Type        | Background                    | Text                         | Border                        | Shadow       |
| ----------- | ----------------------------- | ---------------------------- | ----------------------------- | ------------ |
| Primary     | `var(--color-primary)`        | `var(--color-bg)`            | none                          | primary glow |
| Secondary   | `var(--color-surface-raised)` | `var(--color-text)`          | `var(--color-border-strong)`  | none         |
| Destructive | `var(--color-expense-dim)`    | `var(--color-expense)`       | `var(--color-expense)` at 50% | none         |
| Ghost       | transparent                   | `var(--color-primary)`       | none                          | none         |
| Disabled    | `var(--color-surface)`        | `var(--color-text-disabled)` | none                          | none         |

All buttons: 8px radius, min 44px height, DM Sans 500.

### Filter Chips

- 6px radius, `var(--color-surface)` bg, `var(--color-text-secondary)` text
- Active: `var(--color-primary)` bg, `var(--color-bg)` text, primary glow
- Row: `scrollbar-width: none`, min tap target 36px height

### Toast / Snackbar

- Position: `fixed; bottom: calc(64px + env(safe-area-inset-bottom) + 8px)`, centered, max-width 320px
- Background: `var(--color-surface-raised)`, 12px radius, `1px solid var(--color-border)`
- In: `translateY(8px) → translateY(0)` + `opacity: 0 → 1`, 200ms ease-out
- Out: reverse, 150ms ease-out
- Auto-dismiss: 3s default, 1.5s for "Coming soon"
- `z-index: var(--z-toast)`

### Empty States

```css
.empty-state {
  min-height: 50dvh; /* dynamic viewport — keyboard-aware */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
}
```

- Icon: 64px, `var(--color-text-disabled)`
- Heading: Syne 700, `--text-heading`, `var(--color-text-secondary)`
- Body: DM Sans, `--text-body`, `var(--color-text-secondary)`
- CTA: secondary button (if applicable)

### Coming Soon Stubs

- Visual: `opacity: 0.4; cursor: not-allowed`
- Accessibility: `aria-disabled="true"` + `aria-describedby="coming-soon-label"` where `#coming-soon-label` is a visually hidden span with text "Coming soon"
- Tap → "Coming soon" toast, 1.5s auto-dismiss

---

## Motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .skeleton {
    animation: none;
    opacity: 0.7;
  }
}
```

| Interaction             | Duration        | Easing                          |
| ----------------------- | --------------- | ------------------------------- |
| Button / key press      | 80ms            | ease-out                        |
| Card tap feedback       | 80ms            | ease-out                        |
| Bottom sheet open       | 300ms           | cubic-bezier(0.32, 0.72, 0, 1)  |
| Bottom sheet close      | 220ms           | ease-in                         |
| Tab switch (indicator)  | 150ms           | ease-out                        |
| Tab page transition     | 250ms           | ease-out (View Transitions API) |
| Donut chart draw        | 400ms staggered | ease-out                        |
| Bar chart grow          | 300ms staggered | ease-out                        |
| Toast in / out          | 200ms / 150ms   | ease-out                        |
| Skeleton shimmer        | 1500ms loop     | linear                          |
| Selection toolbar slide | 200ms           | ease-out                        |

No spring physics. Mechanical and precise.

**Tab transitions — View Transitions API:**

```js
// Wrap tab navigation
document.startViewTransition(() => {
  flushSync(() => setActiveTab(newTab));
});
```

```css
::view-transition-old(root) {
  animation: slide-out-left 250ms ease-out;
}
::view-transition-new(root) {
  animation: slide-in-right 250ms ease-out;
}
```

Degrades gracefully where unsupported (instant switch, no error).

---

## Icons

[Lucide](https://lucide.dev/) — MIT, tree-shakable, 24px grid, 1.5px stroke. No mixing icon sets.

| Context                 | Size                       | Stroke |
| ----------------------- | -------------------------- | ------ |
| Bottom nav              | 20px                       | 1.5px  |
| Inline UI / buttons     | 18px                       | 1.5px  |
| Dense lists             | 16px                       | 1.5px  |
| Account/category badges | 18px inside 32–36px circle | 1.5px  |

Icon circle: `border-radius: 9999px`, `background: color-mix(in oklch, var(--card-color) 20%, transparent)`, icon in `var(--card-color)`.

---

## Android PWA Specifics

```html
<meta name="theme-color" content="#0A0B12" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual"
/>
```

```json
{
  "name": "Expenses",
  "short_name": "Expenses",
  "description": "Personal finance tracker",
  "start_url": "/",
  "scope": "/",
  "theme_color": "#0A0B12",
  "background_color": "#0A0B12",
  "display": "standalone",
  "orientation": "portrait",
  "edge-to-edge": true,
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

**Chrome 135+ edge-to-edge:** The viewport now extends fully into the gesture navigation bar. Use `padding-bottom: max(env(safe-area-inset-bottom), 8px)` on the bottom nav — do not rely on a fixed pixel buffer.

**Gesture navigation:** Bottom nav height must pad correctly. Interactive elements must not overlap `env(safe-area-inset-bottom)`.

**Install prompt:** Intercept `beforeinstallprompt`, store event, show a subtle "Add to Home Screen" chip in the app bar. Auto-dismiss after user dismissal. Never block the UI.

---

## Settings View

Full-screen push (slides from right), back arrow top-left. No bottom nav shown.

- Section headers: Syne 700, `var(--color-text-secondary)`, uppercase, `--text-caption`, `letter-spacing: 0.12em`
- Rows: 52px min-height, `border-bottom: 1px solid var(--color-border)`
- Toggle: `var(--color-primary)` when on, `var(--color-border)` track when off, 150ms slide
- Disabled/stub rows: `opacity: 0.4`, `aria-disabled="true"`, tap → "Coming soon" toast
- Light theme option: shows error dialog with `var(--color-expense)` accent (intentional humor)

---

## Accessibility

- All interactive targets: min 44×44px
- Focus rings: `outline: 2px solid var(--color-primary); outline-offset: 2px` — WCAG 2.2 SC 2.4.11 compliant. Never use opacity-only focus indicators.
- Body text contrast ≥ 4.5:1, large text/icons ≥ 3:1
- ARIA labels on all icon-only buttons
- `role="status"` on balance totals that update dynamically
- Amounts: always `+`/`−` prefixed AND color-coded (never color alone)
- Drag handles: `aria-label="Reorder [item name]"`, keyboard accessible via reorder mode buttons
- Coming soon stubs: `aria-disabled="true"` + `aria-describedby` (not `aria-hidden`)

---

## Desktop Adaptation (≥ 768px)

- Content column: max-width 480px, centered, `var(--color-bg)` fills flanks
- Bottom nav: fixed at bottom of content column (not full viewport)
- FAB: positioned relative to content column right edge (not viewport)
- No sidebar, no split-pane — mobile layout at desktop scale
- All interactive elements: `cursor: pointer`
