import type { FixedAssetCategory } from "@/lib/api/accounting";

/** Miroir de backend/src/constants/fixedAssets.js pour l'affichage côté client. */
export const FIXED_ASSET_CATEGORY_LABELS: Record<FixedAssetCategory, string> = {
  informatique: "Matériel informatique",
  mobilier: "Mobilier de bureau",
  transport: "Matériel de transport",
};
