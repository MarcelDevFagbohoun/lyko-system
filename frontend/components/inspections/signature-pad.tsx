"use client";

import * as React from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SignaturePadHandle = {
  /** `null` si rien n'a été dessiné. */
  getBlob: () => Promise<Blob | null>;
  clear: () => void;
  isEmpty: () => boolean;
};

/**
 * Pavé de signature tactile/souris (étape 13, idée n°9 : finalisation d'un
 * état des lieux) — dessin brut sur `<canvas>`, jamais de bibliothèque
 * externe pour un besoin aussi simple. Le tracé est stocké en coordonnées
 * canvas ; `getBlob()` exporte le contenu en PNG pour l'envoyer au serveur.
 */
export const SignaturePad = React.forwardRef<SignaturePadHandle, { label: string; height?: number }>(
  function SignaturePad({ label, height = 140 }, ref) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const drawingRef = React.useRef(false);
    const hasDrawnRef = React.useRef(false);
    const lastPointRef = React.useRef<{ x: number; y: number } | null>(null);
    const [isEmptyState, setIsEmptyState] = React.useState(true);

    const getContext = React.useCallback(() => canvasRef.current?.getContext("2d") ?? null, []);

    // Redimensionne le canvas à la résolution réelle de l'écran (netteté sur mobile/retina).
    React.useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(ratio, ratio);
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#0F172A";
      }
    }, []);

    function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
      e.preventDefault();
      canvasRef.current?.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      lastPointRef.current = pointFromEvent(e);
    }

    function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!drawingRef.current) return;
      const ctx = getContext();
      const point = pointFromEvent(e);
      const last = lastPointRef.current;
      if (ctx && last) {
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
      lastPointRef.current = point;
      if (!hasDrawnRef.current) {
        hasDrawnRef.current = true;
        setIsEmptyState(false);
      }
    }

    function handlePointerUp() {
      drawingRef.current = false;
      lastPointRef.current = null;
    }

    function clear() {
      const canvas = canvasRef.current;
      const ctx = getContext();
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawnRef.current = false;
      setIsEmptyState(true);
    }

    React.useImperativeHandle(ref, () => ({
      isEmpty: () => !hasDrawnRef.current,
      clear,
      getBlob: () =>
        new Promise((resolve) => {
          if (!hasDrawnRef.current || !canvasRef.current) return resolve(null);
          canvasRef.current.toBlob((blob) => resolve(blob), "image/png");
        }),
    }));

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-label-sm text-ink-soft">{label}</span>
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            <Eraser size={14} />
            Effacer
          </Button>
        </div>
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: "none" }}
          className="w-full cursor-crosshair rounded-lg border border-border-strong bg-surface"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        {isEmptyState && <p className="text-body-xs text-ink-faint">Signez ici avec le doigt ou la souris.</p>}
      </div>
    );
  },
);
