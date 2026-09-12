"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Keyboard and focus behaviour shared by the product's two modal surfaces:
 * the centred `Modal` and the mobile navigation drawer in `AppShell`.
 *
 * Both declare `aria-modal`, both cover the page with a backdrop, and both
 * therefore owe the keyboard the same four things: focus moves in on open,
 * Tab cannot leave, Escape closes, and focus returns to whatever opened it.
 * This was written once inside `Modal` and is extracted here so the drawer
 * inherits the proven version rather than growing a second, slightly
 * different focus trap.
 *
 * Deliberately not a dialog framework. It renders nothing and owns no markup:
 * roles, labelling, and layout stay with the component that has the design.
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus({
  /**
   * Whether the surface is open. `Modal` mounts only while open and passes
   * `true`; the drawer stays mounted so it can animate, and passes its state.
   */
  active,
  panelRef,
  onClose,
  /**
   * Focused on open when it matches something inside the panel. Without it
   * the first focusable element is used, which for a panel that opens with a
   * close button would put the user on "close" rather than on the content.
   */
  initialFocusSelector,
}: {
  active: boolean;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusSelector?: string;
}) {
  // Held in a ref so a caller passing an inline arrow does not re-run the
  // effect on every render — which would re-steal focus mid-interaction.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;

    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      ).filter((node) => node.offsetParent !== null);

    const preferred = initialFocusSelector
      ? (panel?.querySelector<HTMLElement>(initialFocusSelector) ?? null)
      : null;
    const initial = preferred ?? focusable()[0];

    // `preventScroll` matters: both surfaces are fixed-position and already
    // fully visible, so there is nothing to scroll to — but without it the
    // browser scrolls the newly focused control into view, which drags the
    // page behind the overlay to the top and loses the reader's place.
    if (initial) {
      initial.focus({ preventScroll: true });
    } else {
      panel?.focus({ preventScroll: true });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const nodes = focusable();
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      // Focus can end up outside the panel — a click on the backdrop, or a
      // control unmounting under it. Tab from there would walk into the page
      // behind the overlay, so it is pulled back to the near edge instead.
      if (!(active instanceof Node) || !panel?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [active, panelRef, initialFocusSelector]);
}
