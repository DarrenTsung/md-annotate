import React, { useCallback, useMemo } from 'react';
import { useAnnotations } from './hooks/useAnnotations.js';
import { Toolbar } from './components/Toolbar.js';
import { MarkdownViewer } from './components/MarkdownViewer.js';
import { CommentSidebar } from './components/CommentSidebar.js';
import type { SourceOffset } from './lib/offsets.js';
import { getAction } from '@shared/actions.js';

function LandingPage() {
  return (
    <div className="landing">
      <h1>md-annotate</h1>
      <p>
        Open a file by navigating to:
        <br />
        <code>http://localhost:3456?file=/path/to/file.md</code>
      </p>
      <p className="landing-hint">
        Or use the <code>/md-annotate</code> skill from Claude Code.
      </p>
    </div>
  );
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const filePath = params.get('file');
  const session = params.get('session');

  if (!filePath) {
    return <LandingPage />;
  }

  return <AnnotationView filePath={filePath} session={session} />;
}

function AnnotationView({ filePath, session }: { filePath: string; session: string | null }) {
  const {
    annotations,
    fileData,
    claudeConnected,
    loading,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
    addComment,
    removeAction,
    activeAnnotationId,
    setActiveAnnotationId,
    versions,
    lastEdited,
    activeVersionId,
    setActiveVersionId,
    pinnedVersionId,
    setPinnedVersionId,
    autoShowVersionId,
    shownDiffHunks,
    versionPreview,
  } = useAnnotations({ filePath, session });

  const handleCreateAnnotation = useCallback(
    async (offset: SourceOffset, comment: string) => {
      const annotation = await createAnnotation({
        selectedText: offset.selectedText,
        startOffset: offset.startOffset,
        endOffset: offset.endOffset,
        contextBefore: offset.contextBefore,
        contextAfter: offset.contextAfter,
        commentText: comment,
      });
      setActiveAnnotationId(annotation.id);
    },
    [createAnnotation, setActiveAnnotationId]
  );

  const handleHighlightClick = useCallback(
    (annotationId: string) => {
      setActiveAnnotationId(annotationId);
      const thread = document.querySelector(
        `.comment-thread[data-annotation-id="${annotationId}"]`
      );
      thread?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    [setActiveAnnotationId]
  );

  const handleActionButtonClick = useCallback(
    async (action: string, sourceStart: number, sourceEnd: number, selectedText: string) => {
      if (!fileData) return;
      const raw = fileData.rawMarkdown;
      const contextBefore = raw.slice(Math.max(0, sourceStart - 30), sourceStart);
      const contextAfter = raw.slice(sourceEnd, sourceEnd + 30);
      const { commentText } = getAction(action);
      const annotation = await createAnnotation({
        selectedText,
        startOffset: sourceStart,
        endOffset: sourceEnd,
        contextBefore,
        contextAfter,
        commentText,
      });
      setActiveAnnotationId(annotation.id);
      // Remove the clicked action from the markdown file (fire and forget;
      // the file watcher will re-render with the updated buttons)
      removeAction(action, sourceStart, sourceEnd);
    },
    [fileData, createAnnotation, setActiveAnnotationId, removeAction]
  );

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        Loading...
      </div>
    );
  }

  if (!fileData) {
    return <div className="error">Failed to load file: {filePath}</div>;
  }

  return (
    <div className="app">
      <Toolbar
        filePath={fileData.filePath}
        claudeConnected={claudeConnected}
        lastEdited={lastEdited}
        versions={versions}
        activeVersionId={activeVersionId}
        autoShowVersionId={autoShowVersionId}
        pinnedVersionId={pinnedVersionId}
        onSetActiveVersion={setActiveVersionId}
        onPinVersion={setPinnedVersionId}
      />
      <div className="main-content">
        <MarkdownViewer
          renderedHtml={versionPreview?.renderedHtml ?? fileData.renderedHtml}
          rawMarkdown={versionPreview?.rawMarkdown ?? fileData.rawMarkdown}
          annotations={annotations}
          activeAnnotationId={activeAnnotationId}
          onCreateAnnotation={handleCreateAnnotation}
          onHighlightClick={handleHighlightClick}
          onActionButtonClick={handleActionButtonClick}
          shownDiffHunks={shownDiffHunks}
          activeVersionId={activeVersionId}
        />
        <CommentSidebar
          annotations={annotations}
          activeAnnotationId={activeAnnotationId}
          onSetActive={setActiveAnnotationId}
          onReply={addComment}
          onResolve={(id) => updateAnnotation(id, 'resolved')}
          onReopen={(id) => updateAnnotation(id, 'open')}
          onDelete={deleteAnnotation}
        />
      </div>
    </div>
  );
}
