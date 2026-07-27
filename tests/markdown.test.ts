import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/server/services/markdown.js';
import { buildSourceMap } from '../src/client/src/lib/offsets.js';

test('renders footnote references and definitions', () => {
  const source = [
    'A claim.[^boundary]',
    '',
    '[^boundary]: Supporting **evidence**.',
    '',
  ].join('\n');

  const html = renderMarkdown(source);

  assert.match(
    html,
    /<sup class="footnote-ref" data-footnote-label="boundary"><a aria-label="Footnote 1" href="#fn-md-annotate:footnote-1" id="fnref-md-annotate:footnote-1">\[1\]<\/a><\/sup>/
  );
  assert.match(html, /<section class="footnotes">/);
  assert.match(
    html,
    /<li id="fn-md-annotate:footnote-1" class="footnote-item">/
  );
  assert.match(html, /Supporting <strong>evidence<\/strong>\./);
  assert.match(
    html,
    /<a aria-label="Back to footnote 1 reference 1" href="#fnref-md-annotate:footnote-1" class="footnote-backref">/
  );
  assert.doesNotMatch(html, /\[\^boundary\]/);
});

test('renders a back reference for every use of a footnote', () => {
  const source = [
    'First use.[^shared] Second use.[^shared]',
    '',
    '[^shared]: Shared note.',
    '',
  ].join('\n');

  const html = renderMarkdown(source);

  assert.match(html, /id="fnref-md-annotate:footnote-1"/);
  assert.match(html, /id="fnref-md-annotate:footnote-1:1"/);
  assert.match(html, /href="#fnref-md-annotate:footnote-1"/);
  assert.match(html, /href="#fnref-md-annotate:footnote-1:1"/);
  assert.match(html, /aria-label="Back to footnote 1 reference 1"/);
  assert.match(html, /aria-label="Back to footnote 1 reference 2"/);
});

test('leaves non-GFM inline footnote syntax as source text', () => {
  const html = renderMarkdown('A claim with an inline note.^[Inline detail.]\n');

  assert.match(html, /\^\[Inline detail\.\]/);
  assert.doesNotMatch(html, /class="footnotes"/);
});

test('namespaces footnote IDs away from heading slugs', () => {
  const html = renderMarkdown(
    '# fn-md-annotate-footnote-1\n\nA claim.[^note]\n\n[^note]: Footnote text.\n'
  );
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);

  assert.match(html, /<h1 [^>]*id="fn-md-annotate-footnote-1"/);
  assert.equal(new Set(ids).size, ids.length);
});

test('preserves multiple paragraphs in a footnote definition', () => {
  const source = [
    'A claim.[^note]',
    '',
    '[^note]: First paragraph.',
    '',
    '    Second paragraph.',
    '',
  ].join('\n');

  const html = renderMarkdown(source);

  assert.match(html, /<p[^>]*>First paragraph\.<\/p>/);
  assert.match(html, /<p[^>]*>Second paragraph\./);
});

test('preserves source offsets on footnote definition content', () => {
  const source = 'A claim.[^note]\n\n[^note]: Footnote text.\n';
  const definitionStart = source.indexOf('[^note]:');
  const definitionEnd = source.length;
  const html = renderMarkdown(source);

  assert.match(
    html,
    new RegExp(
      `<p data-source-start="${definitionStart}" data-source-end="${definitionEnd}">Footnote text\\.`
    )
  );
});

test('source maps omit rendered footnote controls', () => {
  const referenceSource = 'Before[^note] after.';
  const referenceMap = buildSourceMap(referenceSource, {
    footnoteReferenceLabels: ['note'],
  });
  const afterRenderedOffset = 'Before after.'.indexOf('after');

  assert.equal(
    referenceMap[afterRenderedOffset],
    referenceSource.indexOf('after')
  );

  const unresolvedSource = 'Before[^note] [^missing] after.';
  const unresolvedMap = buildSourceMap(unresolvedSource, {
    footnoteReferenceLabels: ['note'],
  });
  const unresolvedRenderedOffset = 'Before [^missing] after.'.indexOf(
    '[^missing]'
  );

  assert.equal(
    unresolvedMap[unresolvedRenderedOffset],
    unresolvedSource.indexOf('[^missing]')
  );

  const definitionSource = '[^note]: Footnote text.\n';
  const definitionMap = buildSourceMap(definitionSource, {
    skipFootnoteDefinitionPrefix: true,
  });

  assert.equal(definitionMap[0], definitionSource.indexOf('Footnote'));

  const continuationSource = '    Continued footnote text.\n';
  const continuationMap = buildSourceMap(continuationSource, {
    skipFootnoteDefinitionPrefix: true,
  });

  assert.equal(
    continuationMap[0],
    continuationSource.indexOf('Continued')
  );

  const quoteSource = '[^note]: > Quoted footnote text.\n';
  const quoteMap = buildSourceMap(quoteSource, {
    skipFootnoteDefinitionPrefix: true,
  });

  assert.equal(quoteMap[0], quoteSource.indexOf('Quoted'));

  const listSource = '    - Footnote list item.\n';
  const listMap = buildSourceMap(listSource, {
    skipFootnoteDefinitionPrefix: true,
  });

  assert.equal(listMap[0], listSource.indexOf('Footnote'));

  const orderedListSource = '    1) Ordered footnote item.\n';
  const orderedListMap = buildSourceMap(orderedListSource, {
    skipFootnoteDefinitionPrefix: true,
  });

  assert.equal(
    orderedListMap[0],
    orderedListSource.indexOf('Ordered')
  );

  const codeSource = '        - literal code bullet\n';
  const codeMap = buildSourceMap(codeSource, {
    skipFootnoteDefinitionPrefix: true,
    codeBlock: true,
  });

  assert.equal(codeMap[0], codeSource.indexOf('- literal'));
  assert.equal(
    codeMap.map((sourceIndex) => codeSource[sourceIndex]).join(''),
    '- literal code bullet\n'
  );

  const indentedCodeSource = '            indented code\n';
  const indentedCodeMap = buildSourceMap(indentedCodeSource, {
    skipFootnoteDefinitionPrefix: true,
    codeBlock: true,
  });

  assert.equal(indentedCodeMap[0], 8);
  assert.equal(
    indentedCodeMap[4],
    indentedCodeSource.indexOf('indented')
  );

  const fencedCodeSource = [
    '    ```js',
    '    const value = "**literal**";',
    '    ```',
    '',
  ].join('\n');
  const fencedCodeMap = buildSourceMap(fencedCodeSource, {
    skipFootnoteDefinitionPrefix: true,
    codeBlock: true,
  });

  assert.equal(
    fencedCodeMap.map((sourceIndex) => fencedCodeSource[sourceIndex]).join(''),
    'const value = "**literal**";\n'
  );

  const indentedFenceSource = [
    '     ```js',
    '     literal',
    '     ```',
    '',
  ].join('\n');
  const indentedFenceMap = buildSourceMap(indentedFenceSource, {
    skipFootnoteDefinitionPrefix: true,
    codeBlock: true,
  });

  assert.equal(
    indentedFenceMap
      .map((sourceIndex) => indentedFenceSource[sourceIndex])
      .join(''),
    'literal\n'
  );

  const blockquotedFenceSource = [
    '    > ```js',
    '    > const quoted = true;',
    '    > ```',
    '',
  ].join('\n');
  const blockquotedFenceMap = buildSourceMap(blockquotedFenceSource, {
    skipFootnoteDefinitionPrefix: true,
    codeBlock: true,
  });

  assert.equal(
    blockquotedFenceMap
      .map((sourceIndex) => blockquotedFenceSource[sourceIndex])
      .join(''),
    'const quoted = true;\n'
  );

  const listedFenceSource = [
    '    - ```js',
    '      const listed = true;',
    '      ```',
    '',
  ].join('\n');
  const listedFenceMap = buildSourceMap(listedFenceSource, {
    skipFootnoteDefinitionPrefix: true,
    codeBlock: true,
  });

  assert.equal(
    listedFenceMap
      .map((sourceIndex) => listedFenceSource[sourceIndex])
      .join(''),
    'const listed = true;\n'
  );
});
