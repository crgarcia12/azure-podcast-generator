'use client';

import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import KeyboardShortcutsModal from './KeyboardShortcutsModal';

export default function KeyboardShortcuts() {
  const { isHelpOpen, setIsHelpOpen } = useKeyboardShortcuts();
  return <KeyboardShortcutsModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />;
}
