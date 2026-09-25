"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

type MenuPosition = { left: number; top: number };

export function bookingMenuPosition(
  anchor: Pick<DOMRect, "top" | "bottom" | "right">,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): MenuPosition {
  const edge = 8;
  const gap = 6;
  const left = Math.max(edge, Math.min(anchor.right - menu.width, viewport.width - menu.width - edge));
  const fitsBelow = anchor.bottom + gap + menu.height <= viewport.height - edge;
  const top = fitsBelow
    ? anchor.bottom + gap
    : Math.max(edge, anchor.top - gap - menu.height);
  return { left, top };
}

export default function BookingActionMenu({ canReturn, onReturn, onDelete }: {
  canReturn: boolean;
  onReturn: () => void;
  onDelete: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const position = useCallback(() => {
    if (!trigger.current || !popover.current) return;
    const button = trigger.current.getBoundingClientRect();
    const menu = popover.current;
    const next = bookingMenuPosition(button, {
      width: menu.offsetWidth || 228,
      height: menu.offsetHeight || (canReturn ? 86 : 44),
    }, { width: window.innerWidth, height: window.innerHeight });
    menu.style.left = `${next.left}px`;
    menu.style.top = `${next.top}px`;
  }, [canReturn]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, position]);

  function choose(action: () => void) {
    popover.current?.hidePopover();
    action();
  }

  return <span className="booking-more">
    <button ref={trigger} type="button" className="booking-more-trigger" popoverTarget={id}
      aria-label="Бусад үйлдэл" aria-haspopup="menu" aria-expanded={open} aria-controls={id}>⋯</button>
    <div ref={popover} id={id} popover="auto" className="booking-more-menu" role="menu" aria-label="Бусад үйлдэл"
      onToggle={event => {
        const expanded = event.currentTarget.matches(":popover-open");
        setOpen(expanded);
        if (expanded) {
          position();
          event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          popover.current?.hidePopover();
          trigger.current?.focus();
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          if (items.length) {
            event.preventDefault();
            items[(current + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
          }
        }
      }}>
      {canReturn && <button type="button" role="menuitem" onClick={() => choose(onReturn)}>Урьдчилсан руу буцаах</button>}
      <button type="button" role="menuitem" className="delete" onClick={() => choose(onDelete)}>Устгах</button>
    </div>
  </span>;
}
