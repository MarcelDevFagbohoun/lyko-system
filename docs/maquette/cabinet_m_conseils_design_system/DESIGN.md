---
name: Cabinet M Conseils Design System
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#444651'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#757682'
  outline-variant: '#c5c5d3'
  surface-tint: '#4059aa'
  primary: '#00236f'
  on-primary: '#ffffff'
  primary-container: '#1e3a8a'
  on-primary-container: '#90a8ff'
  inverse-primary: '#b6c4ff'
  secondary: '#515f74'
  on-secondary: '#ffffff'
  secondary-container: '#d5e3fd'
  on-secondary-container: '#57657b'
  tertiary: '#00246b'
  on-tertiary: '#ffffff'
  tertiary-container: '#00389a'
  on-tertiary-container: '#8da9ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b6c4ff'
  on-primary-fixed: '#00164e'
  on-primary-fixed-variant: '#264191'
  secondary-fixed: '#d5e3fd'
  secondary-fixed-dim: '#b9c7e0'
  on-secondary-fixed: '#0d1c2f'
  on-secondary-fixed-variant: '#3a485c'
  tertiary-fixed: '#dbe1ff'
  tertiary-fixed-dim: '#b4c5ff'
  on-tertiary-fixed: '#00174b'
  on-tertiary-fixed-variant: '#003ea8'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  headline-2xl:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.025em
  headline-xl:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-xs:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  currency-display:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.02em
  currency-table:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter-xs: 0.25rem
  gutter-sm: 0.5rem
  gutter-md: 1rem
  gutter-lg: 1.5rem
  gutter-xl: 2rem
  sidebar-width: 16.25rem
  sidebar-collapsed: 4.5rem
  container-max: 88rem
---

## Brand & Style

The design system establishes a trustworthy, high-density corporate environment tailored for real estate asset management, fiduciary services, and legal consultancy in West Africa. It merges the institutional rigor of francophone notary and legal practices with the modular fluidity of modern enterprise SaaS (shadcn/ui-inspired, clean utility-driven architecture).

### Key Characteristics
- **Personality**: Sovereign, rigorous, dependable, structured. It eliminates visual noise to instill unwavering confidence among property owners, legal counsels, and institutional tenants.
- **Design Movement**: Corporate Modernist SaaS. Characterized by low-contrast borders (`#E2E8F0`), refined white surfaces against ultra-subtle slate canvas (`#F8FAFC`), crisp linear micro-interactions, and purposeful functional semantic accents.
- **Audience**: Asset managers, bailiffs, legal counsels, and enterprise landlords operating primarily in Cotonou and wider West African markets requiring precision record-keeping, strict audit trails, and instant financial reconciliations.

## Colors

The palette balances authoritative deep navy blue with an institutional slate scale. High-contrast functional accents are designated strictly for financial status indicators, asset verification states, and legal lease health.

### Color Tiers & Semantic Tokens
- **Canvas Base**: `#F8FAFC` (Slate 50) establishes a glare-free, executive workspace background.
- **Surface & Panel**: `#FFFFFF` with fine borders (`#E2E8F0`) to distinguish operational blocks.
- **Primary / Corporate Brand**: `#1E3A8A` (Deep Navy) and `#1E40AF` (Hover/Active Cobalt) for primary controls, main navigation active states, and core branding markers.
- **Typography & Content Hierarchy**:
  - Headings & Primary Text: `#0F172A` (Slate 900)
  - Secondary Body & Subtitles: `#334155` (Slate 700)
  - Muted Metadata & Placeholder: `#64748B` (Slate 500)
  - Inactive / Subtle Dividers: `#CBD5E1` (Slate 300)
- **Functional & Ledger States**:
  - **Success / À jour**: `#059669` (Emerald 600) / Background: `#ECFDF5` / Border: `#A7F3D0`
  - **Alert / En cours**: `#D97706` (Amber 600) / Background: `#FFFBEB` / Border: `#FDE68A`
  - **Danger / En retard & Impayé**: `#DC2626` (Red 600) / Background: `#FEF2F2` / Border: `#FECACA`
  - **Info / Procédure**: `#2563EB` (Blue 600) / Background: `#EFF6FF` / Border: `#BFDBFE`

## Typography

The typography couples the engineering-grade geometry of **Geist** for headlines, tabular statistics, and key metrics with the neutral legibility of **Inter** for dense transactional tables, legal contracts, and operational forms.

### Currency & Tabular Rules (FCFA)
- All financial balances rendered in West African CFA Franc (FCFA) must use `font-variant-numeric: tabular-nums` or tabular styling to enforce vertical column alignment.
- The currency unit `FCFA` is presented directly following the numeric total with a non-breaking space (e.g., `1 250 000 FCFA`), styled either in semi-bold weight matching the numeral or in `body-xs` muted uppercase when used inside summary cards.

## Layout & Spacing

The layout is optimized for information density, desktop analytics, and high-frequency administrative workflows.

### Grid & Structure
- **Global Structure**: Persistent vertical navigation sidebar (`260px` standard, collapsible to `72px`) anchored to a fixed top bar (`56px` height) with a fluid content area constrained to a maximum width of `1408px` (`88rem`).
- **Main Content Grid**: A 12-column dynamic CSS grid with 16px (`1rem`) gutters on desktop, scaling down to 8px (`0.5rem`) on mobile viewports.
- **Rhythm**: Standard 4px base multiplier. Card paddings default to 16px (`1rem`) for dense ledger views and 24px (`1.5rem`) for executive summaries and onboarding flows.
- **Breakpoints**:
  - `sm`: 640px (Mobile portrait to stacked cards)
  - `md`: 768px (Tablet view; sidebar transforms into an off-canvas drawer)
  - `lg`: 1024px (Small desktop; fixed compact navigation enabled)
  - `xl`: 1280px (Standard enterprise workstation view; dual-column balance panels)
  - `2xl`: 1536px (High-resolution data dashboards and full multi-column legal schedules)

## Elevation & Depth

The design system minimizes dramatic elevations in favor of subtle boundaries, relying on hairline borders (`1px solid #E2E8F0`) and light ambient shadows inspired by modern enterprise UI conventions.

### Elevation Hierarchy
- **Level 0 (Flat)**: Used for data tables, table cells, form inputs, and inner list items. Relies strictly on `border: 1px solid #E2E8F0`.
- **Level 1 (Card Default - `shadow-sm`)**: Used for analytical metric cards, tenant dossier cards, and document modules. 
  - CSS: `box-shadow: 0 1px 2px 0 rgb(15 23 42 / 0.05); border: 1px solid #E2E8F0; background-color: #FFFFFF;`
- **Level 2 (Hover & Popover)**: Used for interactive row highlights, dropdown menus, and date pickers.
  - CSS: `box-shadow: 0 4px 6px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.04); border: 1px solid #CBD5E1;`
- **Level 3 (Modal & Critical Overlay)**: Used for legal agreement modals, bailiff notification triggers, and receipt confirmations.
  - CSS: `box-shadow: 0 20px 25px -5px rgb(15 23 42 / 0.1), 0 8px 10px -6px rgb(15 23 42 / 0.06);` paired with a backdrop overlay of `rgba(15, 23, 42, 0.4)` and a `2px` backdrop blur.

## Shapes

The interface embraces a disciplined "Soft" curvature token (`roundedness: 1`), conveying structured authority and enterprise composure.

### Geometry Specifications
- **Cards, Panels, & Data Containers**: `rounded-md` (`0.375rem` / `6px`) to `rounded-lg` (`0.5rem` / `8px`).
- **Form Inputs, Buttons, & Dropdowns**: Standard `0.375rem` (`6px`) corner radius to maintain crisp alignment alongside input borders.
- **Pill Badges & Transaction Chips**: Full circular pill radius (`rounded-full` / `9999px`) exclusively reserved for categorical tags, property statuses, and ledger tags to contrast sharply against geometric cards.

## Components

### Buttons
- **Primary**: Solid background `#1E3A8A`, text `#FFFFFF`, hover `#1E40AF`, height `36px` (`sm`) or `40px` (`md`), `6px` radius, inline flex with 8px icon spacing.
- **Secondary / Outline**: Background `#FFFFFF`, border `1px solid #E2E8F0`, text `#0F172A`, hover background `#F8FAFC` and hover border `#CBD5E1`.
- **Destructive**: Background `#DC2626`, text `#FFFFFF`, hover `#B91C1C` for evictions, lease cancellations, and payment rejections.
- **Ghost**: Transparent background, text `#334155`, hover background `#F1F5F9` for secondary table actions.

### Badges & Status Pills
Constructed with full rounded caps (`rounded-full`), `12px` font size (`label-sm`), medium weight, uppercase tracking (`0.025em`), and 2px horizontal padding offset:
- **À jour (Paid / Valid)**: Background `#ECFDF5`, text `#059669`, border `1px solid #A7F3D0`. Includes a 6px solid emerald status dot.
- **En cours (Pending / Draft)**: Background `#FFFBEB`, text `#D97706`, border `1px solid #FDE68A`.
- **En retard / Impayé (Late / Unpaid)**: Background `#FEF2F2`, text `#DC2626`, border `1px solid #FECACA`.
- **Procédure Juridique (Legal Action)**: Background `#EFF6FF`, text `#2563EB`, border `1px solid #BFDBFE`.

### Data Tables (Dense Real Estate Ledger)
- **Header**: Background `#F8FAFC`, uppercase `11px` (`label-sm`), font weight 600, color `#64748B`, height `36px`, bottom border `1px solid #E2E8F0`.
- **Rows**: Alternating white background with hover state `#F8FAFC`, row height `44px`, bottom border `1px solid #F1F5F9`.
- **Financial Alignment**: Numeric amounts and FCFA values aligned flush right with tabular figures.
- **Controls**: Top pagination integrated into the footer with rows-per-page selector, record counter, and page jumping buttons.

### Form Inputs & Selects
- Height `38px`, background `#FFFFFF`, border `1px solid #CBD5E1`, text `#0F172A`, placeholder `#94A3B8`, focus ring `2px #1E3A8A` with a `1px` ring-offset.
- Grouped currency inputs: Attached static addon containing `FCFA` formatted in `#64748B` on the right side of the field.

### Metric Cards (KPI / Stat Cards)
- Background `#FFFFFF`, border `1px solid #E2E8F0`, `shadow-sm`, padding `16px` to `20px`.
- Structure: Metric label in `#64748B` (`label-sm`), large numerical balance in `#0F172A` (`currency-display`), trend delta pill (e.g., `+12.4% vs M-1`) positioned in the upper right corner.

### Legal Dossier Accordions
- Segmented accordions for tenancy leases, property deeds, and bailiff formal notices (`mises en demeure`).
- Left-accent border (`3px solid #1E3A8A`) for current active contracts, collapsed sections show tenant name, property lot identifier, and rental status badge.