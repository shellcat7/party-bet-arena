import { lazy, Suspense } from "react";
import type { PainterlyMeadowProps } from "./PainterlyMeadow";

// The painter is loaded on first use rather than with the app.
const PainterlyMeadow = lazy(() =>
  import("./PainterlyMeadow").then((module) => ({ default: module.PainterlyMeadow })),
);

export function Meadow(props: PainterlyMeadowProps) {
  return (
    <Suspense fallback={<div className="scene-meadow-placeholder" role="img" aria-label={props.label} />}>
      <PainterlyMeadow {...props} />
    </Suspense>
  );
}
