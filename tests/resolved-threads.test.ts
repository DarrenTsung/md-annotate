import test from 'node:test';
import assert from 'node:assert/strict';
import type { Annotation } from '../src/shared/types.js';
import {
  applyResolvedThreadTransitions,
  findResolvedThreadTransitions,
} from '../src/client/src/lib/resolvedThreads.js';

function annotation(id: string, status: Annotation['status']): Annotation {
  return {
    id,
    selectedText: id,
    startOffset: 0,
    endOffset: id.length,
    contextBefore: '',
    contextAfter: '',
    comments: [],
    status,
    stale: false,
    sentToClaude: false,
    working: false,
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  };
}

function reconcile(
  expandedIds: ReadonlySet<string>,
  previousStatuses: ReadonlyMap<string, Annotation['status']>,
  annotations: Annotation[]
) {
  const transitions = findResolvedThreadTransitions(
    previousStatuses,
    annotations
  );
  return {
    expandedIds: applyResolvedThreadTransitions(expandedIds, transitions),
    statuses: transitions.currentStatuses,
  };
}

test('resolved threads remain expanded until explicitly dismissed', () => {
  let expandedIds = new Set<string>();
  let statuses = new Map<string, Annotation['status']>();

  ({ expandedIds, statuses } = reconcile(
    expandedIds,
    statuses,
    [annotation('first', 'open'), annotation('second', 'open')]
  ));
  assert.deepEqual([...expandedIds], []);

  ({ expandedIds, statuses } = reconcile(
    expandedIds,
    statuses,
    [annotation('first', 'resolved'), annotation('second', 'open')]
  ));
  assert.deepEqual([...expandedIds], ['first']);

  ({ expandedIds, statuses } = reconcile(
    expandedIds,
    statuses,
    [annotation('first', 'resolved'), annotation('second', 'resolved')]
  ));
  assert.deepEqual([...expandedIds], ['first', 'second']);

  ({ expandedIds, statuses } = reconcile(
    expandedIds,
    statuses,
    [annotation('first', 'resolved'), annotation('second', 'resolved')]
  ));
  assert.deepEqual([...expandedIds], ['first', 'second']);

  expandedIds = new Set(expandedIds);
  expandedIds.delete('first');
  assert.deepEqual([...expandedIds], ['second']);
});

test('coalesced resolutions expand every newly resolved thread', () => {
  const statuses = new Map<string, Annotation['status']>([
    ['first', 'open'],
    ['second', 'open'],
  ]);

  const result = reconcile(
    new Set(),
    statuses,
    [annotation('first', 'resolved'), annotation('second', 'resolved')]
  );

  assert.deepEqual([...result.expandedIds], ['first', 'second']);
});

test('threads already resolved on initial load stay collapsed', () => {
  const result = reconcile(
    new Set(),
    new Map(),
    [annotation('existing', 'resolved')]
  );

  assert.deepEqual([...result.expandedIds], []);
});

test('reopened and deleted threads stop being force-expanded', () => {
  const expandedIds = new Set(['reopened', 'deleted']);
  const statuses = new Map<string, Annotation['status']>([
    ['reopened', 'resolved'],
    ['deleted', 'resolved'],
  ]);

  const result = reconcile(
    expandedIds,
    statuses,
    [annotation('reopened', 'open')]
  );

  assert.deepEqual([...result.expandedIds], []);
});
