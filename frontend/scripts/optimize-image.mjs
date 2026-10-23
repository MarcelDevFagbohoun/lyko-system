// Optimise une photo pour le site : node scripts/optimize-image.mjs <source> <nom-sortie> [largeurs...]
// Produit public/img/<nom>.webp (plus grande largeur) et public/img/<nom>-<largeur>.webp (versions plus petites).
import sharp from "sharp";
const [src, name, ...w] = process.argv.slice(2);
if (!src || !name) { console.error("Usage : node scripts/optimize-image.mjs <source> <nom> [largeurs]"); process.exit(1); }
const widths = (w.length ? w.map(Number) : [1280, 640]).sort((a, b) => b - a);
for (const [i, width] of widths.entries()) {
  const out = i === 0 ? `public/img/${name}.webp` : `public/img/${name}-${width}.webp`;
  const info = await sharp(src).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78, effort: 5 }).toFile(out);
  console.log(out, `${Math.round(info.size / 1024)} Ko`, `${info.width}x${info.height}`);
}
