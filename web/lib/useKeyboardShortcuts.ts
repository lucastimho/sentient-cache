"use client";

import { useEffect, useRef } from "react";

export interface KeyboardShortcutHandlers {
  onFocusSearch?: () => void;
  onFocusIngest?: () => void;
  onClearHighlights?: () => void;
  onEscape?: () => void;
}

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

// Stable document-level keydown listener. Single-key bindings are suppressed
// while a text input is focused so the user can still type "i" inside the
// ingest field; chorded bindings (Cmd+K) work everywhere.
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = isTextInput(document.activeElement);

      if (e.key === "Escape") {
        ref.current.onEscape?.();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current.onFocusSearch?.();
        return;
      }

      if (inInput) return;

      if (e.key === "/") {
        e.preventDefault();
        ref.current.onFocusSearch?.();
        return;
      }

      if (e.key === "i") {
        e.preventDefault();
        ref.current.onFocusIngest?.();
        return;
      }

      if (e.key === "r") {
        ref.current.onClearHighlights?.();
        return;
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
