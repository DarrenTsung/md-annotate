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

  constructor(filePath: string) {
    this.filePath = filePath;
    this.sidecarPath = filePath + '.annotations.json';
  }

  getSidecarPath(): string {
    return this.sidecarPath;
  }

  read(): AnnotationFile {
    if (!fs.existsSync(this.sidecarPath)) {
      return {
        version: 1,
        filePath: this.filePath,
        annotations: [],
      };
    }
    try {
      const raw = fs.readFileSync(this.sidecarPath, 'utf-8');
      return JSON.parse(raw) as AnnotationFile;
    } catch {
      return {
        version: 1,
        filePath: this.filePath,
        annotations: [],
      };
    }
  }

  private write(data: AnnotationFile): void {
    fs.writeFileSync(this.sidecarPath, JSON.stringify(data, null, 2) + '\n');
  }

  /** Remove all annotations (used when the file is deleted and recreated). */
  clear(): void {
    try { fs.unlinkSync(this.sidecarPath); } catch { /* already gone */ }
  }

  getAll(): Annotation[] {
    return this.read().annotations.filter((a) => a.status !== 'deleted');
  }

  getById(id: string): Annotation | undefined {
    return this.read().annotations.find((a) => a.id === id);
  }

  create(req: CreateAnnotationRequest): Annotation {
    const data = this.read();
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

    data.annotations.push(annotation);
    this.write(data);
    return annotation;
  }

  update(
    id: string,
    updates: Partial<Pick<Annotation, 'status' | 'working'>>
  ): Annotation | null {
    const data = this.read();
    const idx = data.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return null;

    const annotation = data.annotations[idx];
    if (updates.status !== undefined) {
      annotation.status = updates.status;
    }
    if (updates.working !== undefined) {
      annotation.working = updates.working;
    }
    annotation.updatedAt = new Date().toISOString();
    data.annotations[idx] = annotation;
    this.write(data);
    return annotation;
  }

  delete(id: string): boolean {
    const data = this.read();
    const idx = data.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    data.annotations[idx].status = 'deleted';
    data.annotations[idx].updatedAt = new Date().toISOString();
    this.write(data);
    return true;
  }

  addComment(annotationId: string, author: string, text: string): Comment | null {
    const data = this.read();
    const annotation = data.annotations.find((a) => a.id === annotationId);
    if (!annotation) return null;

    const comment: Comment = {
      id: uuidv4(),
      author,
      text,
      createdAt: new Date().toISOString(),
    };

    annotation.comments.push(comment);
    annotation.updatedAt = new Date().toISOString();
    this.write(data);
    return comment;
  }

  markSentToClaude(ids: string[]): void {
    const data = this.read();
    for (const annotation of data.annotations) {
      if (ids.includes(annotation.id)) {
        annotation.sentToClaude = true;
      }
    }
    this.write(data);
  }

  getUnsentAnnotations(): Annotation[] {
    return this.read().annotations.filter(
      (a) => !a.sentToClaude && a.status === 'open'
    );
  }

  /**
   * Re-anchor annotations after the markdown file changes.
   * Returns updated annotations and whether any were changed.
   */
  reanchor(newContent: string): { annotations: Annotation[]; changed: boolean } {
    const data = this.read();
    let changed = false;

    for (const annotation of data.annotations) {
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
      this.write(data);
    }

    return { annotations: data.annotations, changed };
  }
}
