export const ACTION_REGISTRY: Record<string, { label: string; commentText: string }> = {
  elaborate: { label: 'Elaborate', commentText: 'Please elaborate on this.' },
  fix: { label: 'Fix', commentText: 'Please fix this issue.' },
};

/**
 * Look up an action by name. Unknown names fall back to using the name
 * as both label and comment text.
 */
export function getAction(name: string): { label: string; commentText: string } {
  return ACTION_REGISTRY[name] ?? { label: name, commentText: name };
}
