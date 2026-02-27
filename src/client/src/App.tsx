import React, { useCallback } from 'react';
import { useAnnotations } from './hooks/useAnnotations.js';
import { Toolbar } from './components/Toolbar.js';
import { MarkdownViewer } from './components/MarkdownViewer.js';
import { CommentSidebar } from './components/CommentSidebar.js';
import type { SourceOffset } from './lib/offsets.js';

export default function App() {
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
  } = useAnnotations();

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
      // Scroll sidebar thread into view
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
    return <div className="error">Failed to load file</div>;
  }

  return (
    <div className="app">
      <Toolbar filePath={fileData.filePath} claudeConnected={claudeConnected} />
      <div className="main-content">
        <MarkdownViewer
          renderedHtml={fileData.renderedHtml}
          rawMarkdown={fileData.rawMarkdown}
          annotations={annotations}
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
