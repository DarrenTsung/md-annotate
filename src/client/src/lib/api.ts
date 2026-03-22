import type {
  Annotation,
  CreateAnnotationRequest,
  UpdateAnnotationRequest,
  AddCommentRequest,
  Comment,
  FileResponse,
  ClaudeStatusResponse,
  VersionEntry,
  DiffHunk,
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

function fileQuery(filePath: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ filePath });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
  }
  return params.toString();
}

export function createApi(filePath: string, session: string | null) {
  return {
    getFile: () =>
      request<FileResponse>(`/file?${fileQuery(filePath)}`),

    getAnnotations: () =>
      request<Annotation[]>(`/annotations?${fileQuery(filePath)}`),

    createAnnotation: (data: CreateAnnotationRequest) =>
      request<Annotation>(
        `/annotations?${fileQuery(filePath, session ? { session } : undefined)}`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      ),

    updateAnnotation: (id: string, data: UpdateAnnotationRequest) =>
      request<Annotation>(
        `/annotations/${id}?${fileQuery(filePath)}`,
        {
          method: 'PUT',
          body: JSON.stringify(data),
        }
      ),

    deleteAnnotation: (id: string) =>
      request<void>(`/annotations/${id}?${fileQuery(filePath)}`, {
        method: 'DELETE',
      }),

    addComment: (annotationId: string, data: AddCommentRequest) =>
      request<Comment>(
        `/annotations/${annotationId}/comments?${fileQuery(filePath)}`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      ),

    getVersions: () =>
      request<{ versions: VersionEntry[]; lastEdited: string | null }>(
        `/versions?${fileQuery(filePath)}`
      ),

    getVersionDiff: (versionId: string) =>
      request<{ hunks: DiffHunk[] }>(
        `/version-diff?${fileQuery(filePath, { versionId })}`
      ),

    getVersionPreview: (versionId: string) =>
      request<{ rawMarkdown: string; renderedHtml: string; hunks: DiffHunk[] }>(
        `/version-preview?${fileQuery(filePath, { versionId })}`
      ),

    removeAction: (action: string, sourceStart: number, sourceEnd: number) =>
      request<{ modified: boolean }>(
        `/remove-action?${fileQuery(filePath)}`,
        {
          method: 'POST',
          body: JSON.stringify({ action, sourceStart, sourceEnd }),
        }
      ),

    getClaudeStatus: () =>
      request<ClaudeStatusResponse>(
        `/claude/status?${session ? `session=${encodeURIComponent(session)}` : ''}`
      ),
  };
}

export type Api = ReturnType<typeof createApi>;
