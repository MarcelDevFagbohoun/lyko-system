"use client";

import * as React from "react";
import { Eraser, Undo2, Maximize2, Check, PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SignaturePadHandle = {
  /** `null` si rien n'a été dessiné. */
  getBlob: () => Promise<Blob | null>;
  clear: () => void;
  isEmpty: () => boolean;
};

/** Point d'un trait, en coordonnées RELATIVES (0-1) pour survivre à un redimensionnement ; `t` en ms. */
type Point = { x: number; y: number; t: number };
type Stroke = Point[];

const INK = "#0F172A";
const MIN_WIDTH = 1.1;
const MAX_WIDTH = 3.4;

/**
 * Trace les traits sur un contexte 2D de `width` × `height` (px CSS) : courbes lissées passant par
 * le milieu de chaque segment, épaisseur qui diminue quand le geste accélère — le rendu d'un vrai
 * stylo plutôt qu'une ligne brisée d'épaisseur constante. Partagé par l'affichage et l'export.
 */
function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], width: number, height: number, scale = 1) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  const px = (p: Point) => ({ x: p.x * width, y: p.y * height });
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      const p = px(stroke[0]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (MAX_WIDTH / 2) * scale, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    let lastWidth = (MAX_WIDTH * 0.8) * scale;
    for (let i = 1; i < stroke.length; i += 1) {
      const p0 = px(stroke[i - 1]);
      const p1 = px(stroke[i]);
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const dt = Math.max(1, stroke[i].t - stroke[i - 1].t);
      const velocity = dist / dt; // px/ms
      const target = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, MAX_WIDTH - velocity * 1.6)) * scale;
      const w = lastWidth * 0.65 + target * 0.35;
      lastWidth = w;
      const prev = i > 1 ? px(stroke[i - 2]) : p0;
      const startX = (prev.x + p0.x) / 2;
      const startY = (prev.y + p0.y) / 2;
      const endX = (p0.x + p1.x) / 2;
      const endY = (p0.y + p1.y) / 2;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(i > 1 ? startX : p0.x, i > 1 ? startY : p0.y);
      ctx.quadraticCurveTo(p0.x, p0.y, endX, endY);
      ctx.stroke();
      if (i === stroke.length - 1) {
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }
  }
}

/**
 * Zone de dessin seule (utilisée en ligne et en plein écran) : garde le tracé net à toute résolution
 * d'écran et le redessine quand la zone change de taille (rotation du téléphone, plein écran).
 */
function SignatureCanvas({
  strokes,
  onStrokesChange,
  height,
  className,
}: {
  strokes: Stroke[];
  onStrokesChange: (strokes: Stroke[]) => void;
  height: number | string;
  className?: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const currentRef = React.useRef<Stroke | null>(null);
  const strokesRef = React.useRef(strokes);
  strokesRef.current = strokes;

  const redraw = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const all = currentRef.current ? [...strokesRef.current, currentRef.current] : strokesRef.current;
    drawStrokes(ctx, all, rect.width, rect.height);
  }, []);

  React.useEffect(() => {
    redraw();
  }, [strokes, redraw]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height, t: e.timeStamp };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    currentRef.current = [pointFromEvent(e)];
    redraw();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!currentRef.current) return;
    // Points intermédiaires fournis par le navigateur (stylet, écran rapide) : trait plus fidèle.
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    if (events.length > 0) {
      const rect = canvasRef.current!.getBoundingClientRect();
      for (const ev of events) {
        currentRef.current.push({ x: (ev.clientX - rect.left) / rect.width, y: (ev.clientY - rect.top) / rect.height, t: ev.timeStamp });
      }
    } else {
      currentRef.current.push(pointFromEvent(e));
    }
    redraw();
  }

  function handlePointerUp() {
    if (!currentRef.current) return;
    const stroke = currentRef.current;
    currentRef.current = null;
    onStrokesChange([...strokesRef.current, stroke]);
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ height, touchAction: "none" }}
      className={cn("relative block w-full cursor-crosshair", className)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}

/** Fond « papier » : ligne d'appui et croix, comme sur un document à signer. Jamais exporté. */
function SignatureGuide({ empty, compact = false }: { empty: boolean; compact?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-6 bottom-[28%] border-b-2 border-dashed border-border-strong" />
      <span className={cn("absolute bottom-[calc(28%+4px)] left-6 font-display text-ink-faint", compact ? "text-headline-sm" : "text-headline-md")}>
        ✕
      </span>
      {empty && (
        <span className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center gap-2 text-body-sm text-ink-faint">
          <PenLine size={16} />
          Signez ici avec le doigt, un stylet ou la souris
        </span>
      )}
    </div>
  );
}

/**
 * Exporte la signature en PNG transparent, RECADRÉE au plus près du tracé (avec une marge) : dans le
 * PDF, la signature remplit son cadre au lieu d'apparaître minuscule dans un coin.
 */
function exportStrokes(strokes: Stroke[]): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (strokes.length === 0) return resolve(null);
    // Rendu sur un plan de travail fixe (rapport 3:1, haute définition), puis recadrage.
    const W = 1200;
    const H = 400;
    const SCALE = 2.4;
    const work = document.createElement("canvas");
    work.width = W;
    work.height = H;
    const ctx = work.getContext("2d");
    if (!ctx) return resolve(null);
    drawStrokes(ctx, strokes, W, H, SCALE);
    let minX = W, minY = H, maxX = 0, maxY = 0;
    for (const s of strokes) {
      for (const p of s) {
        minX = Math.min(minX, p.x * W);
        maxX = Math.max(maxX, p.x * W);
        minY = Math.min(minY, p.y * H);
        maxY = Math.max(maxY, p.y * H);
      }
    }
    const pad = 24;
    const x = Math.max(0, Math.floor(minX - pad));
    const y = Math.max(0, Math.floor(minY - pad));
    const w = Math.min(W - x, Math.ceil(maxX - minX + pad * 2));
    const h = Math.min(H - y, Math.ceil(maxY - minY + pad * 2));
    const out = document.createElement("canvas");
    out.width = Math.max(1, w);
    out.height = Math.max(1, h);
    out.getContext("2d")?.drawImage(work, x, y, w, h, 0, 0, w, h);
    out.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * Pavé de signature (étape 13, refait à l'étape 56 : « la signature doit être facile, bien propre »).
 * Trait lissé à épaisseur variable, ligne d'appui, annulation du dernier trait, plein écran pour signer
 * confortablement au téléphone, nom du signataire sous la zone, export recadré. Aucune bibliothèque
 * externe : le tracé reste un simple `<canvas>`.
 */
export const SignaturePad = React.forwardRef<SignaturePadHandle, { label: string; signerName?: string; height?: number }>(
  function SignaturePad({ label, signerName, height = 170 }, ref) {
    const [strokes, setStrokes] = React.useState<Stroke[]>([]);
    const [fullscreen, setFullscreen] = React.useState(false);
    const strokesRef = React.useRef(strokes);
    strokesRef.current = strokes;
    const empty = strokes.length === 0;

    React.useImperativeHandle(ref, () => ({
      isEmpty: () => strokesRef.current.length === 0,
      clear: () => setStrokes([]),
      getBlob: () => exportStrokes(strokesRef.current),
    }));

    React.useEffect(() => {
      if (!fullscreen) return;
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previous;
      };
    }, [fullscreen]);

    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-label-md text-ink">
            {label}
            {!empty && (
              <span className="inline-flex animate-cell-pop items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-body-xs font-semibold text-success-fg">
                <Check size={12} />
                Signé
              </span>
            )}
          </span>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={empty} aria-label="Annuler le dernier trait">
              <Undo2 size={14} />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setStrokes([])} disabled={empty}>
              <Eraser size={14} />
              Effacer
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setFullscreen(true)} aria-label="Signer en plein écran">
              <Maximize2 size={14} />
            </Button>
          </div>
        </div>
        <div
          className={cn(
            "relative overflow-hidden rounded-lg border-2 bg-surface transition-colors",
            empty ? "border-dashed border-border-strong" : "border-solid border-success/50",
          )}
        >
          <SignatureGuide empty={empty} compact />
          <SignatureCanvas strokes={strokes} onStrokesChange={setStrokes} height={height} />
        </div>
        {signerName && <p className="text-center text-body-xs text-ink-muted">{signerName}</p>}

        {fullscreen && (
          <div className="fixed inset-0 z-[90] flex animate-fade-in flex-col bg-canvas p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]" role="dialog" aria-modal="true" aria-label={label}>
            <div className="flex items-center justify-between gap-2 pb-3">
              <div>
                <p className="font-label-lg text-ink">{label}</p>
                {signerName && <p className="text-body-sm text-ink-muted">{signerName}</p>}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setFullscreen(false)} aria-label="Fermer">
                <X size={18} />
              </Button>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border-2 border-dashed border-border-strong bg-surface">
              <SignatureGuide empty={empty} />
              <SignatureCanvas strokes={strokes} onStrokesChange={setStrokes} height="100%" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
              <div className="flex items-center gap-1">
                <Button type="button" variant="secondary" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={empty}>
                  <Undo2 size={16} />
                  Annuler
                </Button>
                <Button type="button" variant="ghost" onClick={() => setStrokes([])} disabled={empty}>
                  <Eraser size={16} />
                  Effacer
                </Button>
              </div>
              <Button type="button" onClick={() => setFullscreen(false)} disabled={empty}>
                <Check size={16} />
                Valider la signature
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  },
);
