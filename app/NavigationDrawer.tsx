"use client";

import { useEffect, useRef } from "react";

export default function NavigationDrawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const compact = window.matchMedia("(width < 1200px)");
    if (!compact.matches) { onClose(); return; }
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>(".navigation-drawer-close")?.focus({ preventScroll: true });
    const resized = () => { if (!compact.matches) onClose(); };
    compact.addEventListener("change", resized);
    return () => {
      compact.removeEventListener("change", resized);
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      opener?.focus({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <dialog ref={dialogRef} id="navigation-drawer" className="navigation-drawer" aria-labelledby="navigation-drawer-title"
      onClose={onClose}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
          .filter(control => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        const outsideControls = !controls.includes(document.activeElement as HTMLElement);
        if (event.shiftKey && (document.activeElement === first || outsideControls)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || outsideControls)) {
          event.preventDefault(); first?.focus();
        }
      }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="navigation-drawer-panel">
        <div className="navigation-drawer-heading">
          <h2 id="navigation-drawer-title">Цэс</h2>
          <button type="button" autoFocus className="navigation-drawer-close" aria-label="Цэс хаах" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
