import type { Metadata } from "next";
import { PrimitivesPreview } from "./primitives-preview";

export const metadata: Metadata = {
  title: "UI Primitives",
  robots: { index: false, follow: false },
};

/**
 * Development-only route. Deliberately absent from the sidebar navigation:
 * it previews the shared primitives and is not a product surface.
 */
export default function UiPrimitivesPage() {
  return <PrimitivesPreview />;
}
