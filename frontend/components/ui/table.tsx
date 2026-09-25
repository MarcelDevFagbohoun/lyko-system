"use client";

import * as React from "react";
import { TABLE_TONES, useCardTone } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Tableau dense « registre immobilier » — en-tête surface-muted en majuscules,
 * lignes 44px zébrées (une sur deux légèrement plus sombre), séparateurs
 * hairline, montants alignés à droite (tabular).
 */
function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  // Posé directement sur la page, le tableau prend la teinte du module (liseré + en-tête) ;
  // dans une carte teintée le contexte est remis à blanc : il garde alors la charte neutre.
  const tone = TABLE_TONES[useCardTone()];
  return (
    <div className={cn("w-full overflow-x-auto rounded-lg border bg-surface", tone.wrapper)}>
      <table className={cn("w-full caption-bottom text-left text-body-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  const tone = TABLE_TONES[useCardTone()];
  return (
    <thead
      className={cn(
        tone.head,
        "[&_th]:h-9 [&_th]:px-3 [&_th]:font-label-sm [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn(
        // Lignes zébrées (une sur deux légèrement plus sombre) pour distinguer
        // les lignes d'un coup d'œil sur les tableaux denses.
        "[&_tr]:border-t [&_tr]:border-border [&_tr:nth-child(even)]:bg-surface-muted [&_td]:px-3 [&_td]:py-2.5",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-surface-hover", className)} {...props} />;
}

function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("text-left align-middle", className)} {...props} />;
}

function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("align-middle text-ink", className)} {...props} />;
}

/** Cellule de montant FCFA : flush right, chiffres tabulaires, semi-bold. */
function TableAmount({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("tabular text-right font-currency-table text-ink", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableAmount,
};
