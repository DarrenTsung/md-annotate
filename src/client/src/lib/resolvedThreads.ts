import type { Annotation } from '@shared/types.js';

export interface ResolvedThreadTransitions {
  newlyResolved: Set<string>;
  noLongerResolved: Set<string>;
  currentStatuses: Map<string, Annotation['status']>;
}

export function findResolvedThreadTransitions(
  previousStatuses: ReadonlyMap<string, Annotation['status']>,
  annotations: Annotation[]
): ResolvedThreadTransitions {
  const newlyResolved = new Set<string>();
  const noLongerResolved = new Set<string>();
  const currentStatuses = new Map<string, Annotation['status']>();

  for (const annotation of annotations) {
    const previousStatus = previousStatuses.get(annotation.id);
    currentStatuses.set(annotation.id, annotation.status);
    if (previousStatus === 'open' && annotation.status === 'resolved') {
      newlyResolved.add(annotation.id);
    } else if (
      previousStatus === 'resolved' &&
      annotation.status !== 'resolved'
    ) {
      noLongerResolved.add(annotation.id);
    }
  }

  for (const id of previousStatuses.keys()) {
    if (!currentStatuses.has(id)) noLongerResolved.add(id);
  }

  return { newlyResolved, noLongerResolved, currentStatuses };
}

export function applyResolvedThreadTransitions(
  expandedIds: ReadonlySet<string>,
  transitions: ResolvedThreadTransitions
): Set<string> {
  const next = new Set(expandedIds);
  for (const id of transitions.newlyResolved) next.add(id);
  for (const id of transitions.noLongerResolved) next.delete(id);
  return next;
}
