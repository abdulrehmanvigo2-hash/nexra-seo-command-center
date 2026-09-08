import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Layout for every in-product route. Routes that must render outside the
 * shell (sign-in, error surfaces) can live outside this route group.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
