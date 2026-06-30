export interface AnnotationFile {
  version: 1;
  filePath: string;
  annotations: Annotation[];
}

export interface Annotation {
  id: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  contextBefore: string;
  contextAfter: string;
  comments: Comment[];
  status: 'open' | 'resolved' | 'deleted';
  /** True when the selected text can no longer be found in the file */
  stale: boolean;
  /**
   * Set when the annotation targets an embedded HTML widget rather than a text
   * selection. Holds a concise label (e.g. the widget's `id` or class) so the
   * UI and CLI can show something meaningful instead of dumping the raw HTML.
   */
  embedLabel?: string;
  sentToClaude: boolean;
  working: boolean;
  /** Timestamp when Claude last read this annotation's full state (via
   *  `next`, `start`, or after a successful `reply`). Used to block
   *  reply/resolve if a user comment was added after that point — i.e.
   *  Claude would otherwise be answering stale context. */
  claudeReadAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 'comment' (default) lets Claude decide whether to edit the doc.
 * 'question' tells Claude to answer in-thread and NOT modify the doc.
 * Only meaningful on user-authored comments; Claude replies are always treated as 'comment'.
 */
export type CommentKind = 'comment' | 'question';

export interface Comment {
  id: string;
  author: string; // "user" or "claude"
  text: string;
  /** Optional for backwards-compat — missing means 'comment'. */
  kind?: CommentKind;
  createdAt: string;
}

// API request/response types

export interface CreateAnnotationRequest {
  selectedText: string;
  startOffset: number;
  endOffset: number;
  contextBefore: string;
  contextAfter: string;
  commentText: string;
  kind?: CommentKind;
  /** Concise widget label when the annotation targets an embedded HTML widget. */
  embedLabel?: string;
}

export interface AddCommentRequest {
  author: string;
  text: string;
  kind?: CommentKind;
}

export interface UpdateAnnotationRequest {
  status?: 'open' | 'resolved';
  working?: boolean;
}

export interface FileResponse {
  rawMarkdown: string;
  renderedHtml: string;
  filePath: string;
  lastEdited: string | null;
  versions: VersionEntry[];
}

export interface VersionEntry {
  id: string;
  timestamp: string;
  hunks: DiffHunk[];
  summary: { linesAdded: number; linesRemoved: number };
}

export interface DiffHunk {
  type: 'added' | 'removed' | 'modified';
  value: string;
  /** Rendered HTML for removed/modified hunks. */
  renderedValue?: string;
  newOffset: number;
  oldOffset: number;
}

export interface ClaudeStatusResponse {
  connected: boolean;
  session: string | null;
}

// WebSocket message types

// Server -> Client
export type WsMessage =
  | { type: 'file-changed'; filePath: string; rawMarkdown: string; renderedHtml: string }
  | { type: 'annotations-changed'; filePath: string; annotations: Annotation[] }
  | { type: 'version-created'; filePath: string; version: VersionEntry; lastEdited: string }
  | { type: 'connected' };

// Client -> Server
export type WsClientMessage =
  | { type: 'subscribe'; filePath: string; session?: string };
