import React, { useCallback, useMemo } from 'react';
import { useAnnotations } from './hooks/useAnnotations.js';
import { Toolbar } from './components/Toolbar.js';
import { MarkdownViewer } from './components/MarkdownViewer.js';
import { CommentSidebar } from './components/CommentSidebar.js';
import type { SourceOffset } from './lib/offsets.js';

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
    activeAnnotationId,
    setActiveAnnotationId,
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
      <Toolbar filePath={fileData.filePath} claudeConnected={claudeConnected} />
      <div className="main-content">
        <MarkdownViewer
          renderedHtml={fileData.renderedHtml}
          rawMarkdown={fileData.rawMarkdown}
          annotations={annotations}
          activeAnnotationId={activeAnnotationId}
          onCreateAnnotation={handleCreateAnnotation}
          onHighlightClick={handleHighlightClick}
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
