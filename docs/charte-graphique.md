# Charte graphique — Lyko System

Source : maquette **stitch « Cabinet M Conseils »** (`docs/maquette/`).
Implémentée dans `frontend/tailwind.config.ts` sous forme de tokens sémantiques.
**Aucun écran ne doit employer une couleur hors de cette palette.**

## Couleurs

| Rôle | Token Tailwind | Hex |
|---|---|---|
| Fond de page | `bg-canvas` | `#F8FAFC` |
| Carte / panneau | `bg-surface` | `#FFFFFF` |
| Zone creuse / en-tête tableau | `bg-surface-muted` | `#F1F5F9` |
| Bordure fine | `border-border` | `#E2E8F0` |
| Bordure marquée / focus | `border-border-strong` | `#CBD5E1` |
| Texte principal | `text-ink` | `#0F172A` |
| Texte secondaire | `text-ink-soft` | `#334155` |
| Métadonnées / placeholder | `text-ink-muted` | `#64748B` |
| **Primaire (actions)** | `bg-primary` | `#1E3A8A` |
| Primaire survol/actif | `bg-primary-hover` | `#1E40AF` |

### Statuts (sémantique constante sur toute la plateforme)

| État | Token | Texte | Fond | Bordure |
|---|---|---|---|---|
| À jour / résolu / payé | `success` | `#059669` | `#ECFDF5` | `#A7F3D0` |
| En cours / en attente | `warning` | `#D97706` | `#FFFBEB` | `#FDE68A` |
| En retard / impayé / urgent | `danger` | `#DC2626` | `#FEF2F2` | `#FECACA` |
| Procédure / information | `info` | `#2563EB` | `#EFF6FF` | `#BFDBFE` |

Aplats pleins sur texte blanc (tuiles de tableau de bord) : `success-strong` `#046C4E` ·
`warning-strong` `#A24E07` · `danger-strong` `#B01818` (contraste AA garanti sur blanc).

`whatsapp` (`#25D366`, sombre `#075E54`) : **exclusivement** pour les boutons de relance WhatsApp.

## Typographie

- **Geist** (`font-display`) : titres, montants, indicateurs chiffrés.
- **Inter** (`font-sans`) : corps de texte, tableaux, formulaires.
- Montants FCFA : classe `.tabular` (chiffres tabulaires) + suffixe « FCFA » avec espace insécable — ex. `1 250 000 FCFA`.

Échelle : `headline-2xl` → `headline-sm`, `body-lg` → `body-xs`, `label-md` / `label-sm`, `currency-display` / `currency-table` (voir `tailwind.config.ts`).

## Layout

- Barre de navigation latérale fixe : `260px` (`w-sidebar`), repliable à `72px` (`w-sidebar-collapsed`). Logo de l'entreprise en haut.
- Barre supérieure fixe : `56px` (`h-topbar`).
- Zone de contenu : largeur max `1408px` (`max-w-content-max`), gouttières `1rem` (desktop) / `0.5rem` (mobile) — utilitaire `.content-shell`.
- Rayons : `rounded` (6px) pour inputs/boutons, `rounded-lg` (8px) pour cartes, `rounded-full` réservé aux pastilles de statut.
- Élévations : `shadow-sm` (carte), `shadow-md` (survol/popover), `shadow-lg` (modale).

## Composants de référence (`frontend/components/ui/`)

`Button` · `Card` (+ Header/Title/Description/Content/Footer) · `Badge` · `Input` + `Field` · `Table` (+ Header/Body/Row/Head/Cell/Amount) · `StatCard`.

`StatCard` (`tone`) : sur un tableau de bord, chaque tuile chiffrée reprend la couleur de
son statut réel sur TOUTE la carte, pour que la nature d'une valeur (favorable / à
surveiller / préoccupante) se lise d'un coup d'œil dans la grille. Mêmes tokens que `Badge`
(`success`/`warning`/`danger`/`info`), toujours combinés à une icône + un libellé (jamais
la couleur seule). `tone="default"` reste une carte blanche neutre, pour un chiffre
purement informatif.

Rendu **franc** : aplat plein vert / jaune / rouge sur texte blanc via les teintes
sombres dédiées `success-strong` (`#046C4E`), `warning-strong` (`#A24E07`),
`danger-strong` (`#B01818`) — assez foncées pour un contraste AA sur blanc — avec puce
d'icône dépolie (`bg-white/15`), léger `ring-1 ring-black/5` et `shadow-sm`. Les teintes
`*-bg` pastel de `Badge` restent réservées aux badges. Une tendance « à plat » n'affiche
aucun signe (pas de tiret) ; `▲` / `▼` ne servent qu'aux variations réelles. Sur les
tableaux de bord (comptabilité, DG), la palette reste strictement vert/jaune/rouge — pas
de bleu (`info`), réservé à un usage hors dashboard.

## Responsive

- Points de rupture Tailwind par défaut : `sm` 640px, `md` 768px, `lg` 1024px.
- `EspaceHeader` (espace connecté) : navigation complète en ligne à partir de `lg` (jusqu'à
  10 liens selon le rôle) ; en dessous, tiroir mobile (bouton hamburger) — même gabarit que
  `SiteHeader` (marketing), seuls logo + indicateur de connexion permanent restent visibles
  dans la barre compacte à toutes les tailles.
- `Table` encapsule systématiquement son `<table>` dans un conteneur `overflow-x-auto` —
  tout tableau du registre défile horizontalement sur petit écran sans code additionnel.
- Grilles de cartes/formulaires : toujours `grid-cols-1` en base, `sm:`/`lg:` pour élargir —
  jamais de colonnes fixes sans repli mobile.

Tout nouveau module réutilise ces composants — pas de style ad hoc.
