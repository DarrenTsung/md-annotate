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
  sentToClaude: boolean;
  working: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  author: string; // "user" or "claude"
  text: string;
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
}

export interface AddCommentRequest {
  author: string;
  text: string;
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
  type: 'added' | 'removed';
  value: string;
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
