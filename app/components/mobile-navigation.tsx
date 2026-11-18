"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function MobileNavigation({ open, onOpenChange, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    const mobile = window.matchMedia("(max-width: 650px)");
    if (!dialog || !mobile.matches) { onOpenChange(false); return; }

    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    const resize = () => { if (!mobile.matches) onOpenChange(false); };
    mobile.addEventListener("change", resize);
    return () => {
      mobile.removeEventListener("change", resize);
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onOpenChange]);

  return <dialog ref={ref} id="mobile-navigation" className="mobile-navigation"
    aria-label="Workspace navigation"
    onCancel={event => { event.preventDefault(); onOpenChange(false); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onOpenChange(false);
    }}>
    <button className="icon-button mobile-navigation-close" aria-label="Close menu" onClick={() => onOpenChange(false)}><X size={20} /></button>
    <aside className="sidebar sidebar-mobile">{children}</aside>
  </dialog>;
}
