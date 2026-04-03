import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  AnnotationFile,
  Annotation,
  Comment,
  CreateAnnotationRequest,
} from '../../shared/types.js';

const CONTEXT_LENGTH = 30;

export class AnnotationService {
  private sidecarPath: string;
  private filePath: string;
  /** Authoritative in-memory state. All mutations go through here, then
   *  persist to disk. Eliminates read-modify-write races where concurrent
   *  operations (e.g. user creates annotation while reanchor writes) would
   *  overwrite each other's changes. */
  private data: AnnotationFile;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.sidecarPath = filePath + '.annotations.json';
    this.data = this.loadFromDisk();
  }

  getSidecarPath(): string {
    return this.sidecarPath;
  }

  private loadFromDisk(): AnnotationFile {
    if (!fs.existsSync(this.sidecarPath)) {
      return { version: 1, filePath: this.filePath, annotations: [] };
    }
    try {
      const raw = fs.readFileSync(this.sidecarPath, 'utf-8');
      return JSON.parse(raw) as AnnotationFile;
    } catch {
      return { version: 1, filePath: this.filePath, annotations: [] };
    }
  }

  /** Reload from disk, merging any annotations that only exist in memory.
   *  Used when the sidecar is changed externally (e.g. by another process). */
  reloadFromDisk(): void {
    const disk = this.loadFromDisk();
    // Merge: keep in-memory annotations that aren't on disk (they may
    // have been created between the disk write and now).
    const diskIds = new Set(disk.annotations.map((a) => a.id));
    for (const memAnnotation of this.data.annotations) {
      if (!diskIds.has(memAnnotation.id)) {
        disk.annotations.push(memAnnotation);
      }
    }
    this.data = disk;
  }

  read(): AnnotationFile {
    return this.data;
  }

  private persist(): void {
    fs.writeFileSync(this.sidecarPath, JSON.stringify(this.data, null, 2) + '\n');
  }

  /** Remove all annotations (used when the file is deleted and recreated). */
  clear(): void {
    this.data = { version: 1, filePath: this.filePath, annotations: [] };
    try { fs.unlinkSync(this.sidecarPath); } catch { /* already gone */ }
  }

  getAll(): Annotation[] {
    return this.data.annotations.filter((a) => a.status !== 'deleted');
  }

  getById(id: string): Annotation | undefined {
    return this.data.annotations.find((a) => a.id === id);
  }

  create(req: CreateAnnotationRequest): Annotation {
    const now = new Date().toISOString();

    const annotation: Annotation = {
      id: uuidv4(),
      selectedText: req.selectedText,
      startOffset: req.startOffset,
      endOffset: req.endOffset,
      contextBefore: req.contextBefore,
      contextAfter: req.contextAfter,
      comments: [
        {
          id: uuidv4(),
          author: 'user',
          text: req.commentText,
          createdAt: now,
        },
      ],
      status: 'open',
      stale: false,
      sentToClaude: false,
      working: false,
      createdAt: now,
      updatedAt: now,
    };

    this.data.annotations.push(annotation);
    this.persist();
    return annotation;
  }

  update(
    id: string,
    updates: Partial<Pick<Annotation, 'status' | 'working'>>
  ): Annotation | null {
    const idx = this.data.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return null;

    const annotation = this.data.annotations[idx];
    if (updates.status !== undefined) {
      annotation.status = updates.status;
    }
    if (updates.working !== undefined) {
      annotation.working = updates.working;
    }
    annotation.updatedAt = new Date().toISOString();
    this.persist();
    return annotation;
  }

  delete(id: string): boolean {
    const idx = this.data.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.data.annotations[idx].status = 'deleted';
    this.data.annotations[idx].updatedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  addComment(annotationId: string, author: string, text: string): Comment | null {
    const annotation = this.data.annotations.find((a) => a.id === annotationId);
    if (!annotation) return null;

    const comment: Comment = {
      id: uuidv4(),
      author,
      text,
      createdAt: new Date().toISOString(),
    };

    annotation.comments.push(comment);
    annotation.updatedAt = new Date().toISOString();
    this.persist();
    return comment;
  }

  markSentToClaude(ids: string[]): void {
    let changed = false;
    for (const annotation of this.data.annotations) {
      if (ids.includes(annotation.id) && !annotation.sentToClaude) {
        annotation.sentToClaude = true;
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  getUnsentAnnotations(): Annotation[] {
    return this.data.annotations.filter(
      (a) => !a.sentToClaude && a.status === 'open'
    );
  }

  /**
   * Re-anchor annotations after the markdown file changes.
   * Returns updated annotations and whether any were changed.
   */
  reanchor(newContent: string): { annotations: Annotation[]; changed: boolean } {
    let changed = false;

    for (const annotation of this.data.annotations) {
      // Check if text still matches at stored offsets
      const currentSlice = newContent.slice(
        annotation.startOffset,
        annotation.endOffset
      );
      if (currentSlice === annotation.selectedText) {
        // Text is still at stored offsets — clear stale if it was previously lost
        if (annotation.stale) {
          annotation.stale = false;
          annotation.updatedAt = new Date().toISOString();
          changed = true;
        }
        continue;
      }

      // Try to find the text elsewhere in the document
      const matches: number[] = [];
      let searchStart = 0;
      while (true) {
        const idx = newContent.indexOf(annotation.selectedText, searchStart);
        if (idx === -1) break;
        matches.push(idx);
        searchStart = idx + 1;
      }

      if (matches.length === 0) {
        // Text can't be found — mark stale but keep open so it can still
        // receive replies. The UI will dim these.
        if (!annotation.stale) {
          annotation.stale = true;
          annotation.updatedAt = new Date().toISOString();
          changed = true;
        }
        continue;
      }

      // Score each match by surrounding context, with proximity tiebreaker
      let bestMatch = matches[0];
      let bestScore = 0;

      for (const matchOffset of matches) {
        let score = 0;
        const before = newContent.slice(
          Math.max(0, matchOffset - CONTEXT_LENGTH),
          matchOffset
        );
        const after = newContent.slice(
          matchOffset + annotation.selectedText.length,
          matchOffset + annotation.selectedText.length + CONTEXT_LENGTH
        );

        if (before.endsWith(annotation.contextBefore) && annotation.contextBefore.length >= 5) {
          score += 2;
        } else if (annotation.contextBefore.length >= 10 && before.includes(annotation.contextBefore.slice(-10))) {
          score += 1;
        }

        if (after.startsWith(annotation.contextAfter) && annotation.contextAfter.length >= 5) {
          score += 2;
        } else if (annotation.contextAfter.length >= 10 && after.includes(annotation.contextAfter.slice(0, 10))) {
          score += 1;
        }

        const closer = Math.abs(matchOffset - annotation.startOffset)
                      < Math.abs(bestMatch - annotation.startOffset);
        if (score > bestScore || (score === bestScore && closer)) {
          bestScore = score;
          bestMatch = matchOffset;
        }
      }

      // Require at least partial context match to re-anchor. Without any
      // context evidence the match could be a coincidental duplicate.
      if (bestScore === 0) {
        if (!annotation.stale) {
          annotation.stale = true;
          annotation.updatedAt = new Date().toISOString();
          changed = true;
        }
        continue;
      }

      annotation.startOffset = bestMatch;
      annotation.endOffset = bestMatch + annotation.selectedText.length;
      annotation.stale = false;

      // Update context
      annotation.contextBefore = newContent.slice(
        Math.max(0, bestMatch - CONTEXT_LENGTH),
        bestMatch
      );
      annotation.contextAfter = newContent.slice(
        annotation.endOffset,
        annotation.endOffset + CONTEXT_LENGTH
      );

      annotation.updatedAt = new Date().toISOString();
      changed = true;
    }

    if (changed) {
      this.persist();
    }

    return { annotations: this.data.annotations, changed };
  }
}
