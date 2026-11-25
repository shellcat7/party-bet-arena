import { useEffect, useRef } from "react";
import { createMeadowEngine } from "./meadowPainter";
import type { MeadowEngine } from "./meadowPainter";

export interface PainterlyMeadowProps {
  /** Accessible description of the scene (announced as an image). */
  label: string;
  /** Seed for the painting; the same seed and size always give the same painting. */
  seed?: number;
  /** Stops the wind animation (the last frame stays on screen). */
  paused?: boolean;
  className?: string;
}

/**
 * A windy hilltop painted stroke by stroke in the manner of Monet's
 * "Woman with a Parasol" (1875). Fills the width of its container; the container sets the height.
 * Requires `src/styles/scenes.css`.
 */
export function PainterlyMeadow({ label, seed = 1875, paused = false, className }: PainterlyMeadowProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLCanvasElement>(null);
  const groundRef = useRef<HTMLCanvasElement>(null);
  const motionRef = useRef<HTMLCanvasElement>(null);
  const veilRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MeadowEngine | null>(null);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
    engineRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    const root = rootRef.current;
    const sky = skyRef.current;
    const ground = groundRef.current;
    const motion = motionRef.current;
    const veil = veilRef.current;
    if (!root || !sky || !ground || !motion || !veil) return;
    const engine = createMeadowEngine(
      { root, sky, ground, motion, veil },
      { seed, paused: pausedRef.current },
    );
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [seed]);

  return (
    <div ref={rootRef} className={className ? `scene-meadow ${className}` : "scene-meadow"}>
      <canvas ref={skyRef} className="scene-meadow__layer scene-meadow__sky" aria-hidden="true" />
      <canvas ref={groundRef} className="scene-meadow__layer" role="img" aria-label={label} />
      <canvas ref={motionRef} className="scene-meadow__layer" aria-hidden="true" />
      <canvas ref={veilRef} className="scene-meadow__layer" aria-hidden="true" />
    </div>
  );
}
