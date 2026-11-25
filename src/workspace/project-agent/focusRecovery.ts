/**
 * Error-state focus recovery utilities for Project Agent workbench (Part 1 §3).
 *
 * Automatically moves focus to the primary recovery action when an error or
 * blocking state occurs, while strictly refusing to steal focus if the user is
 * currently typing in an editable control (INPUT / TEXTAREA / SELECT / contentEditable).
 */

const EDITABLE_TAG_NAMES = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function isEditableFocusTarget(element: Element | null | undefined): boolean {
  if (!element) {
    return false
  }
  if (EDITABLE_TAG_NAMES.has(element.tagName.toUpperCase())) {
    return true
  }
  if (element instanceof HTMLElement) {
    if (element.isContentEditable) {
      return true
    }
    const contentEditableAttr = element.getAttribute('contenteditable')
    if (
      contentEditableAttr !== null &&
      contentEditableAttr.toLowerCase() !== 'false'
    ) {
      return true
    }
  }
  return false
}

export function focusRecoveryElement(element: HTMLElement | null | undefined): boolean {
  if (!element) {
    return false
  }
  if (element instanceof HTMLButtonElement && element.disabled) {
    return false
  }
  if (typeof document !== 'undefined' && isEditableFocusTarget(document.activeElement)) {
    return false
  }
  element.focus()
  return typeof document === 'undefined' ? true : document.activeElement === element
}
