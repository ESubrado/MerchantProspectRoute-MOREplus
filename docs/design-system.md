# SurnMore design system

## Intent

SurnMore is the client-directed wordmark for this modern B2B outbound-sales platform. Its visual system is designed for calm, trustworthy and high-density operational work: users should identify reply risk, sequence health and ownership without losing context or feeling surrounded by dashboard noise.

The visual system, component styling, layout, palette and implementation were designed independently. At the user's explicit direction, the SurnMore mark in `public/surnmore-logo.svg` is a copied local asset from SOURCE; it has no runtime or build-time dependency on SOURCE. The SurnMore wordmark was also updated at the user's direction.

The mark is presented as a monochrome glyph on the target primary surface using a contained screen blend, so the asset sits naturally within the target palette without modifying the copied file.

## Principles

1. **Signal before decoration.** Status, recency, owner and exceptions receive visual priority; decoration stays restrained.
2. **One work surface.** The app uses a top navigation shell and a wide, breathable content canvas. Page-specific work stays inside consistent panels rather than accumulating nested rails.
3. **Density with recovery room.** Compact rows and 14px operational type are balanced by a 64px top bar, grouped filters and clear whitespace between content blocks.
4. **Stable meaning.** Teal is for workflow/active state; blue is for primary action and navigation; green, amber and red are reserved for success, attention and risk.
5. **Progressive disclosure.** Tables scan first, drawers inspect second, and dedicated pages are reserved for multi-step work.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#E2E9EE` | Application background |
| `surface` | `#FFFFFF` | Cards, menus, table surfaces |
| `surface-subtle` | `#F3F6F8` | Table headers, quiet controls |
| `ink` | `#13212D` | Primary text |
| `ink-muted` | `#5E6B78` | Supporting text |
| `line` | `#D9E1E7` | Borders and dividers |
| `line-strong` | `#BDCAd4` | Input/control borders |
| `primary` | `#1E5D95` | Main actions, focus, navigation |
| `primary-soft` | `#E8F1F9` | Selected navigation and quiet primary state |
| `teal` | `#08776E` | Active workflow/context label |
| `success` | `#19714F` | Positive delivery/reply health |
| `warning` | `#9B5D07` | Attention or pending risk |
| `danger` | `#AE3041` | DNC, failures, destructive state |
| `info` | `#2D659A` | Informational delivery state |

Every semantic color has a soft background and a border companion in the implementation. Text never relies only on color: status pills include text and a dot, while tables include descriptive status labels.

## Typography

The current stack is system UI (`Arial`, `Helvetica`, sans-serif) for reliable metric rendering and zero external font dependency.

| Role | Size / line-height | Weight | Use |
| --- | --- | --- | --- |
| Display | 32px / 38px | 600 | Page titles |
| Section | 18px / 26px | 600 | Card headings and drawers |
| Body | 14px / 20px | 400 | Tables, forms, helper copy |
| Small | 12px / 16px | 500–700 | Labels, status, timestamps |
| Eyebrow | 12px / 16px | 700 | Uppercase product area context |

## Spacing, shape, and elevation

- Base unit: 4px. Common gaps: 8, 12, 16, 20, 24, 32 and 36px.
- Controls: 32px compact and 36px standard height; never below 32px for touchable controls.
- Cards and menus: 12px radius. Buttons, fields and navigation controls: 8px radius.
- Elevation: resting cards use `0 1px 2px rgb(19 33 45 / 5%)`; floating menus and drawers use a single, stronger shadow. No decorative multi-layer shadows.
- Dividers use `line`; a surface change is preferred to excessive borders.

## States and interaction patterns

| Pattern | Rule |
| --- | --- |
| Navigation | Overview is a direct top-level link; CRM, Outreach, Inbox and Administration are grouped area navigation. Desktop uses a menu; mobile uses a scrollable direct-link row. |
| Summary charts | State the time range and series meaning in adjacent text, use a legible SVG/chart title, and provide a textual equivalent for assistive technology. A chart supplements, never replaces, an operational status. |
| Tables | Compact 56px-ish rows, sticky semantic header treatment, horizontal overflow on small screens, never a squeezed multi-line mobile table. |
| Filters | Search comes first, then horizontally scrollable pressed-state filter chips. Filter meaning remains textual. |
| Status | Use `StatusPill` with label, dot and semantic tone. DNC/failure must use `danger`; stopped/pending work uses `warning`. |
| Drawers | Native modal dialog with Esc close, focus handling, labelled heading and visible close control. Use for inspection/edit; use a full page for multistep creation. |
| Forms | Label every field; pair short helper text with constraints; primary action is right-aligned in a stable footer or action row. |
| Loading | Preserve expected surface structure and show a concise progress label instead of layout shift. |
| Empty | Explain the absence, its cause, and the next safe action. |
| Error | State what failed, retain the user's context, and offer a retry path. |

## Accessibility standards

- Text, borders and state color combinations target WCAG AA contrast. Primary/teal/danger semantic text is paired with high-contrast foregrounds and labels.
- All interactive controls use a 2px visible primary focus ring with offset; keyboard users can reach navigation menus, filters, table actions and drawers.
- Native elements are preferred: links for navigation, buttons for actions, `details/summary` for top menus and `dialog` for modal drawers.
- Inputs have programmatic labels; icon-only controls have `aria-label`; table columns use table header semantics.
- Motion is limited to color and menu-chevron transitions. Nothing critical depends on animation.
- Mobile navigation and filters scroll horizontally rather than truncating action choices; tables retain readable column widths inside a scroll container.

## Theme decision

The initial release is **light mode only**. A dark mode has not been added because operational status colors, data-table contrast and native drawer/menu surfaces must be verified as a complete system, not inverted opportunistically.

## Implementation inventory

- Shell: `components/app-shell.tsx`
- Primitives: `components/ui/*`
- Domain patterns: `components/domain/*`
- Feature examples: `components/screens/*`
- Visual QA: `docs/visual-qa-checklist.md`
