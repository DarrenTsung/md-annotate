export function mermaidLabelOccurrences(labelTexts: string[]): number[] {
  const counts = new Map<string, number>();
  return labelTexts.map((text) => {
    const occurrence = counts.get(text) ?? 0;
    counts.set(text, occurrence + 1);
    return occurrence;
  });
}

export function findMermaidLabelIndex(
  labelTexts: string[],
  text: string,
  occurrence: number
): number | null {
  let seen = 0;
  for (let index = 0; index < labelTexts.length; index++) {
    if (labelTexts[index] !== text) continue;
    if (seen === occurrence) return index;
    seen++;
  }
  return null;
}

export function findMermaidBlockAnchor(
  rawMarkdown: string,
  sourceStart: number,
  sourceEnd: number
): { start: number; end: number; text: string } | null {
  const block = rawMarkdown.slice(sourceStart, sourceEnd);
  if (!block) return null;
  const newline = block.indexOf('\n');
  const anchorLength = newline === -1 ? block.length : newline + 1;
  return {
    start: sourceStart,
    end: sourceStart + anchorLength,
    text: block.slice(0, anchorLength),
  };
}

/**
 * Tag rendered labels with stable visual identities. Source offsets remain on
 * the containing diagram because Mermaid does not expose label source ranges.
 */
export function annotateMermaidLabels(
  wrapper: HTMLElement,
  sourceStart: number,
  sourceEnd: number
): number {
  wrapper.setAttribute('data-source-start', String(sourceStart));
  wrapper.setAttribute('data-source-end', String(sourceEnd));

  const svg = wrapper.querySelector('svg');
  if (!svg) return 0;

  const labels = Array.from(svg.querySelectorAll('foreignObject, text')).filter(
    (element) => (element.textContent || '').trim().length > 0
  );
  const labelTexts = labels.map((label) => label.textContent || '');
  const occurrences = mermaidLabelOccurrences(labelTexts);

  for (let labelIndex = 0; labelIndex < labels.length; labelIndex++) {
    const label = labels[labelIndex];
    label.setAttribute('data-mermaid-label', '');
    label.setAttribute('data-mermaid-label-text', labelTexts[labelIndex]);
    label.setAttribute(
      'data-mermaid-label-occurrence',
      String(occurrences[labelIndex])
    );
  }

  return labels.length;
}
