# src/components

[root CLAUDE.md](../../CLAUDE.md)

## Purpose

React components used by pages. Organised by feature: `accounts/`, `admin/`, `budget/`, `categories/`, `layout/`, `onboarding/`, `overview/`, `settings/`, `shared/`, `transactions/`.

## Key directories

- `layout/` — `TabLayout`, `BottomNav`, `TopBar`, `BottomSheet`, `ContentColumn`.
- `shared/` — generic primitives reused across features: `AmountDisplay`, `Numpad`, `CalendarPicker`, `ColorPicker`, `IconPicker`, `Toast`, `ConfirmDialog`, `ErrorBoundary`, `FilterChips`, `CurrencyPicker`, `EmptyState`, `PeriodFilter`, `ComingSoonStub`, `IntegrityErrorScreen`.
- Feature folders (`accounts/`, `transactions/`, `budget/`, `categories/`, `overview/`, `settings/`) — one folder per tab.
- `admin/` — admin dashboard widgets.
- `onboarding/` — `OnboardingFlow` and step components.

## Public surface

- Anything exported from a feature folder can be imported by its sibling page (e.g. `pages/AccountsPage.tsx` imports from `components/accounts/`).
- `shared/` is the only folder freely importable from anywhere.

## Conventions

- **Inline `style={{}}` only — NEVER Tailwind utility classes in JSX.** Reference CSS tokens defined in `src/styles/index.css` (`var(--color-fg)`, `var(--space-4)`, etc.).
- **Minimum touch target: 44×44 px** for every interactive element. Use `min-height` / `min-width` via CSS tokens.
- **All monetary values render through `AmountDisplay`** — never call `formatAmount` inline in JSX. `AmountDisplay` enforces JetBrains Mono + semantic color + glow.
- **Dark theme only.** Do not author light-theme variants; the theme setting shows a humor dialog (see `settings/ThemeSetting.tsx`).
- **No Recharts for the categories donut** — use the hand-rolled `categories/DonutChart.tsx` SVG.
- Use Lucide icon names listed in `utils/constants.ts:ICON_LIST` for `IconPicker`.
- No Spring-physics animations — mechanical timing only (CSS transitions in tokens).
- Translate user-facing strings via `useTranslation()` (`hooks/use-translation.ts`).
- Components reading domain data should use the `useX` hooks (`hooks/use-accounts.ts` etc.), not call Dexie directly.

## Gotchas

- `BottomSheet` traps focus and locks scroll — nest carefully.
- `Numpad` outputs **minor units** (cents). Multiply / divide ONLY at this boundary, never deeper.
- `IntegrityErrorScreen` is rendered before settings load — it must not import the settings store.
- `Toast` provider is mounted once in `App.tsx`; use `useToast()` to push.

## Tests

- Co-located `*.test.tsx` files (Vitest + Testing Library). Run with `npm test`. Add tests next to the component you change.
