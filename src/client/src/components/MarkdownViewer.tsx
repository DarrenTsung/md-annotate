import React, { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import morphdom from 'morphdom';
import type { Annotation, CommentKind, DiffHunk } from '@shared/types.js';
import { applyHighlights, applyPendingHighlight } from '../lib/highlight.js';
import { applyDiffOverlay } from '../lib/diffOverlay.js';
import { annotateMermaidLabels } from '../lib/mermaid.js';
import { useTextSelection } from '../hooks/useTextSelection.js';
import { SelectionPopover } from './SelectionPopover.js';
import { Minimap } from './Minimap.js';
import type { SourceOffset } from '../lib/offsets.js';

mermaid.initialize({ startOnLoad: false, theme: 'neutral' });

/**
 * Assign a unique `data-morph-key` to every descendant so morphdom's keyed
 * matching can reuse unchanged nodes without duplicating blocks that share
 * identical text (e.g. several paragraphs containing just "Procedure:"). We
 * prefer tagName+text as the base so reuse survives source-offset shifts,
 * and append an occurrence counter to disambiguate collisions.
 */
function assignMorphKeys(root: HTMLElement): void {
  const counts = new Map<string, number>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Element | null;
  while ((node = walker.nextNode() as Element | null)) {
    const el = node as HTMLElement;
    const text = (el.textContent || '').slice(0, 80);
    if (!text) {
      el.removeAttribute('data-morph-key');
      continue;
    }
    const base = el.tagName + ':' + text;
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    el.setAttribute('data-morph-key', n === 0 ? base : `${base}#${n}`);
  }
}

/**
 * Find the block element closest to the viewport top — used as the scroll
 * anchor reference point before DOM updates.
 */
function findAnchorElement(container: HTMLElement, scroller: HTMLElement | null): HTMLElement | null {
  if ((scroller?.scrollTop ?? 0) < 10) return null;

  const blocks = container.querySelectorAll('[data-source-start]');
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;

  for (const block of blocks) {
    const distance = Math.abs(block.getBoundingClientRect().top);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = block as HTMLElement;
    }
  }
  return best;
}

/**
 * Find the embedded-widget element an annotation is anchored to (annotations on
 * widgets have no `<mark>`; they're keyed to the embed's source-offset range).
 */
function findEmbedForAnnotation(
  container: HTMLElement | null,
  annotations: Annotation[],
  annotationId: string
): HTMLElement | null {
  if (!container) return null;
  const ann = annotations.find((a) => a.id === annotationId);
  if (!ann) return null;
  const embeds = Array.from(container.querySelectorAll('.html-embed[data-source-start]')) as HTMLElement[];
  for (const embed of embeds) {
    const start = parseInt(embed.getAttribute('data-source-start') || '0', 10);
    const end = parseInt(embed.getAttribute('data-source-end') || '0', 10);
    // Range overlap (tolerant of small re-anchoring drift), rather than strict
    // containment, so the embed still matches if its block offset shifted a bit.
    if (ann.startOffset < end && ann.endOffset > start) return embed;
  }
  return null;
}

/**
 * Derive a concise label for an embedded widget from its source HTML — its
 * `id`, else its first class, else a generic fallback.
 */
function widgetLabel(blockHtml: string): string {
  const id = blockHtml.match(/\bid=["']([^"']+)["']/);
  if (id) return id[1];
  const cls = blockHtml.match(/\bclass=["']([^"'\s]+)/);
  if (cls) return cls[1];
  return 'embedded widget';
}

interface MarkdownViewerProps {
  renderedHtml: string;
  rawMarkdown: string;
  annotations: Annotation[];
  activeAnnotationId: string | null;
  onCreateAnnotation: (offset: SourceOffset, comment: string, kind: CommentKind, opts?: { embedLabel?: string }) => void;
  onDeleteText: (offset: SourceOffset) => void;
  onHighlightClick: (annotationId: string) => void;
  onActionButtonClick: (action: string, sourceStart: number, sourceEnd: number, selectedText: string) => void;
  onNavigateFile: (resolvedPath: string) => void;
  filePath: string;
  shownDiffHunks: DiffHunk[] | null;
  activeVersionId: string | null;
}

export function MarkdownViewer({
  renderedHtml,
  rawMarkdown,
  annotations,
  activeAnnotationId,
  onCreateAnnotation,
  onDeleteText,
  onHighlightClick,
  onActionButtonClick,
  onNavigateFile,
  filePath,
  shownDiffHunks,
  activeVersionId,
}: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The scrollable column wrapping the article — this scrolls, not the window.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { selection, clearSelection } = useTextSelection(containerRef, rawMarkdown);
  const [mermaidRenderVersion, setMermaidRenderVersion] = useState(0);
  // Popover state for commenting on an embedded HTML widget (which has no
  // selectable text of its own — the comment anchors to its source block).
  const [embedSel, setEmbedSel] = useState<{ offset: SourceOffset; rect: DOMRect; embedLabel: string } | null>(null);

  // --- Content freeze during comment composition ---
  // While the selection popover is open, freeze the displayed content so
  // file edits don't shift the viewport or invalidate the pending highlight.
  const frozenContentRef = useRef<{ html: string; markdown: string } | null>(null);

  if (selection && !frozenContentRef.current) {
    frozenContentRef.current = { html: renderedHtml, markdown: rawMarkdown };
  } else if (!selection) {
    frozenContentRef.current = null;
  }

  const displayHtml = frozenContentRef.current?.html ?? renderedHtml;
  const displayMarkdown = frozenContentRef.current?.markdown ?? rawMarkdown;

  // --- Incremental DOM updates with morphdom + scroll anchoring ---
  // morphdom makes minimal DOM changes, preserving unchanged nodes. We capture
  // the scroll anchor before updating, then adjust scroll after paint (scrollBy
  // doesn't take effect during useLayoutEffect after DOM mutations).
  const prevDisplayHtmlRef = useRef<string>('');
  const scrollAdjustRef = useRef<{ el: HTMLElement; offset: number } | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (displayHtml === prevDisplayHtmlRef.current) return;
    prevDisplayHtmlRef.current = displayHtml;

    if (container.children.length === 0) {
      container.innerHTML = displayHtml;
      return;
    }

    // Capture scroll anchor before morphing
    const anchorEl = findAnchorElement(container, scrollerRef.current);
    const anchorOffset = anchorEl?.getBoundingClientRect().top ?? 0;

    const target = document.createElement('article');
    target.innerHTML = displayHtml;
    assignMorphKeys(container);
    assignMorphKeys(target);
    morphdom(container, target, {
      childrenOnly: true,
      getNodeKey(node) {
        if (node instanceof HTMLElement) {
          return node.getAttribute('data-morph-key') ?? undefined;
        }
        return undefined;
      },
      onBeforeElUpdated(from, to) {
        // Preserve a mounted embed iframe when its content hasn't changed —
        // letting morphdom reconcile it would tear out the live iframe (and
        // reset any interactive widget state inside).
        if (
          from.classList?.contains('html-embed') &&
          from.getAttribute('data-embed-srcdoc') === to.getAttribute('data-embed-srcdoc')
        ) {
          return false;
        }
        if (from.isEqualNode(to)) return false;
        return true;
      },
    });

    // Store anchor info for post-paint scroll adjustment
    if (anchorEl && anchorEl.isConnected) {
      scrollAdjustRef.current = { el: anchorEl, offset: anchorOffset };
    }
  }, [displayHtml]);

  // Adjust scroll after paint — the browser needs to complete layout before
  // scroll operations take effect after DOM mutations.
  useEffect(() => {
    const adj = scrollAdjustRef.current;
    if (!adj) return;
    scrollAdjustRef.current = null;

    if (!adj.el.isConnected) return;
    const newOffset = adj.el.getBoundingClientRect().top;
    const adjustment = newOffset - adj.offset;
    if (Math.abs(adjustment) > 1) {
      scrollerRef.current?.scrollBy(0, adjustment);
    }
  }, [displayHtml]);

  // Apply highlights only when annotations or HTML change — NOT activeAnnotationId.
  // useLayoutEffect to avoid flash between cleanup and re-apply.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scroller = scrollerRef.current;
    const scrollY = scroller?.scrollTop ?? 0;
    const cleanup = applyHighlights(container, annotations, displayMarkdown);
    if (scroller) scroller.scrollTop = scrollY;
    return cleanup;
  }, [annotations, displayHtml, displayMarkdown, mermaidRenderVersion]);

  // Toggle active class on marks — separate from highlight injection so
  // clicking a comment never tears down / re-creates the mark elements.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear any previous active
    container
      .querySelectorAll('.annotation-highlight.active')
      .forEach((m) => m.classList.remove('active'));
    container.querySelectorAll('.html-embed.active').forEach((e) => e.classList.remove('active'));

    if (activeAnnotationId) {
      container
        .querySelectorAll(
          `.annotation-highlight[data-annotation-id="${activeAnnotationId}"]`
        )
        .forEach((m) => m.classList.add('active'));
      // Embedded widgets have no <mark>; highlight the embed block instead.
      const embed = findEmbedForAnnotation(container, annotations, activeAnnotationId);
      embed?.classList.add('active');
    }
  }, [activeAnnotationId, annotations, displayHtml, mermaidRenderVersion]);

  // Scroll to and blink the active highlight when a comment is selected
  useEffect(() => {
    if (!activeAnnotationId) return;

    const mark =
      document.querySelector(
        `.annotation-highlight[data-annotation-id="${activeAnnotationId}"]`
      ) ||
      findEmbedForAnnotation(containerRef.current, annotations, activeAnnotationId);
    if (!mark) return;

    // Only scroll if the highlight isn't already visible within the doc column
    const markRect = mark.getBoundingClientRect();
    const viewRect = scrollerRef.current?.getBoundingClientRect();
    const top = viewRect?.top ?? 0;
    const bottom = viewRect?.bottom ?? window.innerHeight;
    if (markRect.top < top || markRect.bottom > bottom) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    mark.classList.add('highlight-blink');

    const timer = setTimeout(() => {
      mark.classList.remove('highlight-blink');
    }, 1500);

    return () => {
      clearTimeout(timer);
      mark.classList.remove('highlight-blink');
    };
  }, [activeAnnotationId, annotations, mermaidRenderVersion]);

  // Highlight the pending selection while the popover is open
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !selection) return;

    const scroller = scrollerRef.current;
    const scrollY = scroller?.scrollTop ?? 0;
    const cleanup = applyPendingHighlight(
      container,
      selection.offset.startOffset,
      selection.offset.endOffset,
      selection.offset.selectedText,
      displayMarkdown,
      selection.offset.mermaidLabel
    );
    // DOM manipulation can shift scroll; restore it
    if (scroller) scroller.scrollTop = scrollY;
    return cleanup;
  }, [selection, displayMarkdown, mermaidRenderVersion]);

  // Apply diff overlay when hunks are available
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !shownDiffHunks || shownDiffHunks.length === 0) return;

    const scroller = scrollerRef.current;
    const scrollY = scroller?.scrollTop ?? 0;
    const cleanup = applyDiffOverlay(container, shownDiffHunks);
    if (scroller) scroller.scrollTop = scrollY;
    return cleanup;
  }, [shownDiffHunks, displayHtml, mermaidRenderVersion]);

  // Render mermaid diagrams after HTML is injected
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const codeBlocks = container.querySelectorAll('code.language-mermaid');
    if (codeBlocks.length === 0) return;

    let cancelled = false;

    (async () => {
      let renderedAny = false;
      for (const code of codeBlocks) {
        if (cancelled) return;
        const pre = code.parentElement;
        if (!pre || pre.tagName !== 'PRE') continue;

        const source = code.textContent || '';
        const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
        try {
          const { svg } = await mermaid.render(id, source);
          if (cancelled) return;
          const liveSelection = window.getSelection();
          if (
            liveSelection &&
            !liveSelection.isCollapsed &&
            liveSelection.rangeCount > 0 &&
            pre.contains(liveSelection.getRangeAt(0).commonAncestorContainer)
          ) {
            continue;
          }
          const wrapper = document.createElement('div');
          wrapper.className = 'mermaid-diagram';
          wrapper.innerHTML = svg;
          const sourceStartAttr = code.getAttribute('data-source-start');
          const sourceEndAttr = code.getAttribute('data-source-end');
          if (sourceStartAttr !== null && sourceEndAttr !== null) {
            const sourceStart = Number(sourceStartAttr);
            const sourceEnd = Number(sourceEndAttr);
            if (Number.isFinite(sourceStart) && Number.isFinite(sourceEnd)) {
              annotateMermaidLabels(wrapper, sourceStart, sourceEnd);
            }
          }
          pre.replaceWith(wrapper);
          renderedAny = true;
        } catch {
          // Leave the code block as-is if rendering fails
        }
      }
      if (renderedAny && !cancelled) {
        setMermaidRenderVersion((version) => version + 1);
      }
    })();

    return () => { cancelled = true; };
  }, [displayHtml, selection]);

  // Open the comment popover for an embedded widget. The comment anchors to
  // the widget's source block, but the popover is positioned next to the click
  // target (the 💬 button) rather than the tall widget itself.
  const openEmbedComment = useCallback((embed: HTMLElement, anchorRect?: DOMRect) => {
    const start = parseInt(embed.getAttribute('data-source-start') || '0', 10);
    const end = parseInt(embed.getAttribute('data-source-end') || '0', 10);
    const raw = displayMarkdown;
    const block = raw.slice(start, end);
    // Anchor to a short, real substring of the source so re-anchoring across
    // edits keeps working (the rendered widget itself has no selectable text).
    const head = block.replace(/\s+/g, ' ').trim().slice(0, 80);
    const selectedText = head || 'Embedded widget';
    const anchorEnd = start + selectedText.length;
    const offset: SourceOffset = {
      startOffset: start,
      endOffset: anchorEnd,
      selectedText,
      contextBefore: raw.slice(Math.max(0, start - 30), start),
      contextAfter: raw.slice(anchorEnd, anchorEnd + 30),
    };
    setEmbedSel({ offset, rect: anchorRect ?? embed.getBoundingClientRect(), embedLabel: widgetLabel(block) });
  }, [displayMarkdown]);

  // Keep a stable reference to the latest handler so the delegated click
  // listener (mounted once) always calls the current closure.
  const openEmbedCommentRef = useRef(openEmbedComment);
  openEmbedCommentRef.current = openEmbedComment;

  // Mount sandboxed iframes into embed placeholders and add a comment affordance.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const embeds = Array.from(
      container.querySelectorAll('.html-embed[data-embed-srcdoc]')
    ) as HTMLElement[];

    for (const embed of embeds) {
      if (embed.querySelector('iframe')) continue; // already mounted

      const b64 = embed.getAttribute('data-embed-srcdoc') || '';
      let srcdoc = '';
      try {
        srcdoc = new TextDecoder().decode(
          Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        );
      } catch {
        continue;
      }

      const iframe = document.createElement('iframe');
      iframe.className = 'html-embed-frame';
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('scrolling', 'no');
      iframe.srcdoc = srcdoc;
      embed.appendChild(iframe);

      // The comment button's click is handled via delegation below — no
      // per-button listener (which would die when this effect re-runs and
      // skips already-mounted embeds).
      const btn = document.createElement('button');
      btn.className = 'html-embed-comment';
      btn.title = 'Comment on this widget';
      btn.textContent = '💬';
      embed.appendChild(btn);
    }
  }, [displayHtml]);

  // Delegated click handler for embed comment buttons (stable across renders).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function onClick(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest?.('.html-embed-comment');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const embed = btn.closest('.html-embed') as HTMLElement | null;
      if (embed) openEmbedCommentRef.current(embed, btn.getBoundingClientRect());
    }
    container.addEventListener('click', onClick);
    return () => container.removeEventListener('click', onClick);
  }, []);

  // Size each embed iframe to its content (reported via postMessage).
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data;
      if (!data || data.__htmlEmbed !== 1 || typeof data.height !== 'number') return;
      const container = containerRef.current;
      if (!container) return;
      const frames = container.querySelectorAll('iframe.html-embed-frame');
      for (const frame of frames) {
        if ((frame as HTMLIFrameElement).contentWindow === e.source) {
          (frame as HTMLIFrameElement).style.height = `${Math.ceil(data.height)}px`;
          break;
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function handleSubmitEmbedComment(comment: string, kind: CommentKind) {
    if (embedSel) {
      onCreateAnnotation(embedSel.offset, comment, kind, { embedLabel: embedSel.embedLabel });
      setEmbedSel(null);
    }
  }

  // Keyboard shortcuts active while a selection is live:
  //  - Cmd/Ctrl+C copies the selected text and dismisses the popover
  //  - Cmd/Ctrl+Delete (or Cmd/Ctrl+Backspace) deletes the selected text
  //    directly from the file. The modifier is required so a stray Delete /
  //    Backspace (e.g. while editing the comment box) can't nuke the document.
  useEffect(() => {
    if (!selection) return;

    function handleKeyDown(e: KeyboardEvent) {
      const mermaidSelectionText = selection!.offset.mermaidLabel
        ? selection!.offset.mermaidLabel.text.slice(
            selection!.offset.mermaidLabel.selectionStart,
            selection!.offset.mermaidLabel.selectionEnd
          )
        : null;
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        navigator.clipboard.writeText(
          mermaidSelectionText ?? selection!.offset.selectedText
        );
        clearSelection();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (selection!.offset.mermaidLabel) return;
        // Once the user has typed a comment, Cmd/Ctrl+Backspace is a normal
        // line-edit shortcut in the comment box — don't hijack it to delete
        // the document. A fresh (empty) selection still deletes.
        const el = document.activeElement as HTMLElement | null;
        const editing =
          el &&
          (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) &&
          !!(el as HTMLInputElement | HTMLTextAreaElement).value;
        if (editing) return;

        e.preventDefault();
        onDeleteText(selection!.offset);
        clearSelection();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selection, clearSelection, onDeleteText]);

  // Handle clicks on highlights and anchor links
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;

      // Action button clicks
      const actionBtn = target.closest('.action-btn') as HTMLElement | null;
      if (actionBtn) {
        e.preventDefault();
        const action = actionBtn.getAttribute('data-action');
        const block = actionBtn.closest('[data-source-start]') as HTMLElement | null;
        if (action && block) {
          const sourceStart = parseInt(block.getAttribute('data-source-start')!, 10);
          const sourceEnd = parseInt(block.getAttribute('data-source-end')!, 10);
          // Use rendered text content (excluding action button labels) so the
          // highlight code can find an exact match instead of falling back to
          // offset-ratio positioning which bleeds into adjacent elements.
          // In a table the block is the whole <tr>, but the button lives in a
          // single cell — scope the highlight text to that cell so it doesn't
          // span (and visually mangle) the entire row.
          const cell = actionBtn.closest('td, th') as HTMLElement | null;
          const textSource = cell ?? block;
          const clone = textSource.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('.action-buttons').forEach((el) => el.remove());
          const selectedText = (clone.textContent || '').trim();
          onActionButtonClick(action, sourceStart, sourceEnd, selectedText);
        }
        return;
      }

      // Annotation highlight clicks
      const mark = target.closest('.annotation-highlight[data-annotation-id]');
      if (mark) {
        const id = mark.getAttribute('data-annotation-id');
        if (id) onHighlightClick(id);
        return;
      }

      // Anchor link clicks — smooth scroll instead of navigating
      const anchorLink = target.closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (anchorLink) {
        e.preventDefault();
        const id = decodeURIComponent(anchorLink.getAttribute('href')!.slice(1));
        const heading = document.getElementById(id);
        if (heading) {
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      // Relative .md link clicks — navigate within md-annotate
      const mdLink = target.closest('a') as HTMLAnchorElement | null;
      if (mdLink) {
        const href = mdLink.getAttribute('href') || '';
        // Skip external links, anchors, and non-.md files
        if (/^[a-z]+:/i.test(href) || href.startsWith('#')) return;
        const mdPath = href.replace(/#.*$/, ''); // strip anchor
        if (!mdPath.endsWith('.md')) return;

        e.preventDefault();
        // Resolve relative to current file's directory
        const currentDir = filePath.substring(0, filePath.lastIndexOf('/'));
        const parts = (currentDir + '/' + mdPath).split('/');
        const resolved: string[] = [];
        for (const p of parts) {
          if (p === '..') resolved.pop();
          else if (p !== '.' && p !== '') resolved.push(p);
        }
        onNavigateFile('/' + resolved.join('/'));
      }
    }

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [onHighlightClick, onActionButtonClick, onNavigateFile, filePath]);

  function handleSubmitComment(comment: string, kind: CommentKind) {
    if (selection) {
      onCreateAnnotation(selection.offset, comment, kind);
      clearSelection();
      // Scroll anchoring handles viewport stability on the unfreeze re-render
    }
  }

  return (
    <div className="markdown-viewer-container" ref={scrollerRef}>
      <article
        ref={containerRef}
        className="markdown-viewer"
      />
      <Minimap contentRef={containerRef} scrollRef={scrollerRef} />
      {selection && (
        <SelectionPopover
          rect={selection.rect}
          selectedText={
            selection.offset.mermaidLabel
              ? selection.offset.mermaidLabel.text.slice(
                  selection.offset.mermaidLabel.selectionStart,
                  selection.offset.mermaidLabel.selectionEnd
                )
              : selection.offset.selectedText
          }
          onSubmit={handleSubmitComment}
          onCancel={clearSelection}
        />
      )}
      {embedSel && (
        <SelectionPopover
          rect={embedSel.rect}
          selectedText="Embedded widget"
          onSubmit={handleSubmitEmbedComment}
          onCancel={() => setEmbedSel(null)}
        />
      )}
    </div>
  );
}
