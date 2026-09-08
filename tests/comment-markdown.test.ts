import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCommentMarkdown } from '../src/client/src/components/ThreadComments.js';

test('comment tables render headers, aligned values, and surrounding prose', () => {
  const html = renderCommentMarkdown(`Before → fixed means:

| Case | Before | Fixed |
|---|---:|---:|
| Sparse equal | 104.0 ns | 99.5 ns |
| **Overlay** | 123.0 ns | 102.6 ns |

No regression detected.`);
  assert.match(html, /<p>Before → fixed means:<\/p>/);
  assert.match(html, /class="comment-table-scroll"/);
  assert.match(html, /<thead>\s*<tr>\s*<th>Case<\/th>/);
  assert.match(html, /<td style="text-align:right">99.5 ns<\/td>/);
  assert.match(html, /<td><strong>Overlay<\/strong><\/td>/);
  assert.match(html, /<p>No regression detected\.<\/p>/);
});

test('code stays literal, while prose retains formatting and line breaks', () => {
  const html = renderCommentMarkdown('**Bold** and *italic*\n`**literal**`\n\n```md\n| A | B |\n|---|---|\n| x | y |\n```');
  assert.match(html, /<strong>Bold<\/strong> and <em>italic<\/em><br>/);
  assert.match(html, /<code>\*\*literal\*\*<\/code>/);
  assert.match(html, /<pre><code class="language-md">\| A \| B \|/);
  assert.doesNotMatch(html, /<table>/);
});

test('tables handle escaped pipes and escape HTML in cells', () => {
  const html = renderCommentMarkdown('| Value |\n|---|\n| a\\|b |\n| <img src=x onerror=alert(1)> |');
  assert.match(html, /<td>a\|b<\/td>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
});
