import { lazy, Suspense } from "react";
import type { Biome } from "../../lib/pass";
import type { PainterlyMeadowProps } from "./PainterlyMeadow";

// The painter is loaded on first use rather than with the app.
const PainterlyMeadow = lazy(() =>
  import("./PainterlyMeadow").then((module) => ({ default: module.PainterlyMeadow })),
);

export function Meadow(props: PainterlyMeadowProps & { biome?: Biome }) {
  // Biomes arrive with the landscape painter; until then every ticket shows the meadow.
  const { biome: _biome, ...rest } = props;
  return (
    <Suspense fallback={<div className="scene-meadow-placeholder" role="img" aria-label={props.label} />}>
      <PainterlyMeadow {...rest} />
    </Suspense>
  );
}
