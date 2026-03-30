import React, { useRef, useEffect, useCallback } from 'react';

interface MinimapProps {
  /** Ref to the markdown article element */
  contentRef: React.RefObject<HTMLElement | null>;
}

/**
 * VS Code-style minimap showing a scaled-down representation of the document
 * with diff coloring and a viewport indicator.
 */
export function Minimap({ contentRef }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const isDragging = useRef(false);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const content = contentRef.current;
    const wrapper = containerRef.current;
    if (!canvas || !content || !wrapper) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const mapWidth = wrapper.clientWidth;
    const mapHeight = wrapper.clientHeight;
    canvas.width = mapWidth * dpr;
    canvas.height = mapHeight * dpr;
    canvas.style.width = `${mapWidth}px`;
    canvas.style.height = `${mapHeight}px`;
    ctx.scale(dpr, dpr);

    const docHeight = content.scrollHeight;
    const viewportHeight = window.innerHeight;
    const scrollTop = window.scrollY;
    const toolbarHeight = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--toolbar-height') || '0'
    );

    // Scale factor: cap at a natural density so short docs don't stretch
    // to fill the full minimap height. ~0.15 means 1px in the minimap ≈ 7px
    // in the document, which looks reasonable for most font sizes.
    const maxScale = 0.15;
    const scale = Math.min(maxScale, mapHeight / docHeight);

    // Clear
    ctx.clearRect(0, 0, mapWidth, mapHeight);

    // Draw text density lines from block elements
    const blocks = content.querySelectorAll(
      'p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, table, hr'
    );

    const contentRect = content.getBoundingClientRect();
    const contentTop = contentRect.top + scrollTop - toolbarHeight;

    // Base text color
    const textColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-muted')?.trim() || '#999';

    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      const top = rect.top + scrollTop - toolbarHeight - contentTop;
      const height = rect.height;
      const y = top * scale;
      const h = Math.max(1, height * scale);

      // Check for diff classes
      const el = block as HTMLElement;
      const isAdded = el.classList.contains('diff-added');
      const isModified = el.classList.contains('diff-modified');
      const isRemoved = el.classList.contains('diff-removed');

      // Also check parent for diff class (e.g., <li> inside <ol class="diff-added">)
      const parentAdded = el.parentElement?.classList.contains('diff-added');

      // Draw a thin representation of the block
      const heading = block.tagName.match(/^H[1-6]$/);
      const barWidth = heading ? mapWidth * 0.7 : mapWidth * 0.55;
      const barH = Math.max(1, h - 1);

      if (isRemoved) {
        ctx.fillStyle = 'rgba(248, 81, 73, 0.5)';
        ctx.fillRect(2, y, barWidth, barH);
      } else if (isAdded || parentAdded) {
        ctx.fillStyle = 'rgba(46, 160, 67, 0.5)';
        ctx.fillRect(2, y, barWidth, barH);
      } else if (isModified) {
        // Draw proportional segments: grey for unchanged, red for <del>, green for <ins>
        const delLen = Array.from(el.querySelectorAll('del'))
          .reduce((s, e) => s + (e.textContent?.length || 0), 0);
        const insLen = Array.from(el.querySelectorAll('ins'))
          .reduce((s, e) => s + (e.textContent?.length || 0), 0);
        const totalLen = el.textContent?.length || 1;
        const unchangedLen = Math.max(0, totalLen - delLen - insLen);

        let x = 2;
        // Unchanged (grey)
        if (unchangedLen > 0) {
          const w = (unchangedLen / totalLen) * barWidth;
          ctx.fillStyle = textColor;
          ctx.globalAlpha = 0.15;
          ctx.fillRect(x, y, w, barH);
          ctx.globalAlpha = 1;
          x += w;
        }
        // Removed (red)
        if (delLen > 0) {
          const w = (delLen / totalLen) * barWidth;
          ctx.fillStyle = 'rgba(248, 81, 73, 0.5)';
          ctx.fillRect(x, y, w, barH);
          x += w;
        }
        // Added (green)
        if (insLen > 0) {
          const w = (insLen / totalLen) * barWidth;
          ctx.fillStyle = 'rgba(46, 160, 67, 0.5)';
          ctx.fillRect(x, y, w, barH);
        }
      } else {
        ctx.fillStyle = textColor;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(2, y, barWidth, barH);
        ctx.globalAlpha = 1;
      }
    }

    // Also draw inserted <del> elements (removed diff blocks)
    const removedEls = content.parentElement?.querySelectorAll('del.diff-removed');
    if (removedEls) {
      ctx.fillStyle = 'rgba(248, 81, 73, 0.5)';
      for (const el of removedEls) {
        const rect = el.getBoundingClientRect();
        const top = rect.top + scrollTop - toolbarHeight - contentTop;
        const y = top * scale;
        const h = Math.max(2, rect.height * scale);
        ctx.fillRect(2, y, mapWidth * 0.55, h);
      }
    }

    // Draw viewport indicator
    const vpTop = Math.max(0, (scrollTop - contentTop) * scale);
    const vpHeight = viewportHeight * scale;
    ctx.fillStyle = 'rgba(128, 128, 128, 0.12)';
    ctx.fillRect(0, vpTop, mapWidth, vpHeight);
  }, [contentRef]);

  // Repaint on scroll, resize, and content changes
  useEffect(() => {
    function onScrollOrResize() {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(paint);
    }

    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);

    // Observe content changes (e.g., diff overlay applied)
    const observer = new MutationObserver(onScrollOrResize);
    if (contentRef.current) {
      observer.observe(contentRef.current, { childList: true, subtree: true, attributes: true });
    }

    // Initial paint
    requestAnimationFrame(paint);

    return () => {
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [paint, contentRef]);

  // Click/drag to scroll
  const scrollToY = useCallback((clientY: number) => {
    const wrapper = containerRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    const rect = wrapper.getBoundingClientRect();
    const docHeight = content.scrollHeight;
    const maxScale = 0.15;
    const scale = Math.min(maxScale, rect.height / docHeight);
    const mapContentHeight = docHeight * scale;
    const ratio = (clientY - rect.top) / mapContentHeight;
    const targetScroll = ratio * docHeight - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, targetScroll), behavior: 'auto' });
  }, [contentRef]);

  useEffect(() => {
    const wrapper = containerRef.current;
    if (!wrapper) return;

    function onMouseDown(e: MouseEvent) {
      isDragging.current = true;
      scrollToY(e.clientY);
      e.preventDefault();
    }
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      scrollToY(e.clientY);
    }
    function onMouseUp() {
      isDragging.current = false;
    }

    wrapper.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      wrapper.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [scrollToY]);

  return (
    <div ref={containerRef} className="minimap">
      <canvas ref={canvasRef} />
    </div>
  );
}
