import { useEffect, useRef } from "react";
import { createMeadowEngine } from "./meadowPainter";
import type { MeadowBiome, MeadowEngine, MeadowLight } from "./meadowPainter";

export type { MeadowBiome, MeadowLight };

export interface PainterlyMeadowProps {
  /** Accessible description of the scene (announced as an image). */
  label: string;
  /** Seed for the painting; the same seed, biome, light and size always give the same painting. */
  seed?: number;
  /**
   * Stops the wind animation (the last frame stays on screen). Paused from the first render, the
   * painting is a single still frame and no animation loop runs at all.
   */
  paused?: boolean;
  className?: string;
  /**
   * The landscape: a windy meadow (default), a snowy mountain range, desert dunes, sea cliffs,
   * lavender rows, an autumn wood, an alpine lake, cherry trees by a river or a wheat field.
   */
  biome?: MeadowBiome;
  /** The hour: full daylight (default), golden hour or dusk. */
  light?: MeadowLight;
}

/**
 * A landscape with the wind moving through it, painted stroke by stroke in an Impressionist
 * manner. Fills its container; the container sets the size. Composed for ticket artwork, from
 * 16:10 to 3:1. Requires `src/styles/scenes.css`.
 */
export function PainterlyMeadow({
  label,
  seed = 1875,
  paused = false,
  className,
  biome = "meadow",
  light = "day",
}: PainterlyMeadowProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLCanvasElement>(null);
  const groundRef = useRef<HTMLCanvasElement>(null);
  const treesRef = useRef<HTMLCanvasElement>(null);
  const motionRef = useRef<HTMLCanvasElement>(null);
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
    const trees = treesRef.current;
    const motion = motionRef.current;
    if (!root || !sky || !ground || !trees || !motion) return;
    const engine = createMeadowEngine(
      { root, sky, ground, trees, motion },
      { seed, paused: pausedRef.current, biome, light },
    );
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [seed, biome, light]);

  return (
    <div
      ref={rootRef}
      className={className ? `scene-meadow ${className}` : "scene-meadow"}
      data-biome={biome}
      data-light={light}
    >
      <canvas ref={skyRef} className="scene-meadow__layer scene-meadow__sky" aria-hidden="true" />
      <canvas ref={groundRef} className="scene-meadow__layer" role="img" aria-label={label} />
      <canvas ref={treesRef} className="scene-meadow__layer" aria-hidden="true" />
      <canvas ref={motionRef} className="scene-meadow__layer" aria-hidden="true" />
    </div>
  );
}
