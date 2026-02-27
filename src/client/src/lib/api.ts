import type {
  Annotation,
  CreateAnnotationRequest,
  UpdateAnnotationRequest,
  AddCommentRequest,
  Comment,
  FileResponse,
  ClaudeStatusResponse,
} from '@shared/types.js';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  getFile: () => request<FileResponse>('/file'),

  getAnnotations: () => request<Annotation[]>('/annotations'),

  createAnnotation: (data: CreateAnnotationRequest) =>
    request<Annotation>('/annotations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAnnotation: (id: string, data: UpdateAnnotationRequest) =>
    request<Annotation>(`/annotations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteAnnotation: (id: string) =>
    request<void>(`/annotations/${id}`, { method: 'DELETE' }),

  addComment: (annotationId: string, data: AddCommentRequest) =>
    request<Comment>(`/annotations/${annotationId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getClaudeStatus: () => request<ClaudeStatusResponse>('/claude/status'),
};
