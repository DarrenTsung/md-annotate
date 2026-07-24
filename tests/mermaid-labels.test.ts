import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findMermaidBlockAnchor,
  findMermaidLabelIndex,
  mermaidLabelOccurrences,
} from '../src/client/src/lib/mermaid.js';

test('assigns repeated rendered labels distinct visual occurrences', () => {
  const labels = ['Same', 'Same', 'Unique', 'Same'];

  assert.deepEqual(mermaidLabelOccurrences(labels), [0, 1, 0, 2]);
  assert.equal(findMermaidLabelIndex(labels, 'Same', 0), 0);
  assert.equal(findMermaidLabelIndex(labels, 'Same', 1), 1);
  assert.equal(findMermaidLabelIndex(labels, 'Same', 2), 3);
});

test('does not infer label identity from Mermaid source order', () => {
  const renderedOrder = ['edge label', 'node label', 'node label'];

  assert.equal(findMermaidLabelIndex(renderedOrder, 'node label', 1), 2);
  assert.equal(findMermaidLabelIndex(renderedOrder, 'missing', 0), null);
});

test('preserves multiline rendered label identity', () => {
  assert.equal(
    findMermaidLabelIndex(['FooBar', 'Other'], 'FooBar', 0),
    0
  );
});

test('anchors comments to the fence so unrelated diagram edits stay valid', () => {
  const original = [
    'before',
    '```mermaid',
    'flowchart LR',
    '  A[Ready] --> B[Waiting]',
    '```',
  ].join('\n');
  const sourceStart = original.indexOf('```mermaid');
  const sourceEnd = original.indexOf('```', sourceStart + 3) + 3;
  const anchor = findMermaidBlockAnchor(original, sourceStart, sourceEnd);
  assert.ok(anchor);
  assert.equal(anchor.text, '```mermaid\n');

  const edited = original.replace('Waiting', 'Done');
  assert.equal(edited.slice(anchor.start, anchor.end), anchor.text);
});
