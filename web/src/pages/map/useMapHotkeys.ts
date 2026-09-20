import { useEffect } from 'react';
import { isTypingTarget } from './helpers';

export function useMapHotkeys(deps: {
  undo: () => void;
  redo: () => void;
  copySelection: () => void;
  pasteSelection: () => void;
  setShowCommands: (open: boolean) => void;
  // [open, close] pairs, ordered topmost-first — Escape closes the topmost
  // open surface (every modal and the person panel).
  closers: [boolean, () => void][];
}) {
  const { undo, redo, copySelection, pasteSelection, setShowCommands, closers } =
    deps;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowCommands(true);
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (command && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }
      if (command && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, copySelection, pasteSelection, setShowCommands]);

  // Escape closes the topmost open surface — every modal and the person panel.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      for (const [open, close] of closers) {
        if (open) {
          close();
          return;
        }
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [closers]);
}
