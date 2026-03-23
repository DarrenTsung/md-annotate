import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { diffLines } from 'diff';
import type { VersionEntry, DiffHunk } from '../../shared/types.js';

const MAX_VERSIONS = 50;
const TMP_ROOT = '/tmp/md-annotate';

export class VersionHistory {
  private dir: string;
  private snapshotsDir: string;
  private cachedPath: string;
  private versionsPath: string;

  constructor(filePath: string) {
    const hash = crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 12);
    const basename = path.basename(filePath, path.extname(filePath));
    this.dir = path.join(TMP_ROOT, `${hash}-${basename}`);
    this.snapshotsDir = path.join(this.dir, 'snapshots');
    this.cachedPath = path.join(this.dir, 'cached.md');
    this.versionsPath = path.join(this.dir, 'versions.json');

    fs.mkdirSync(this.snapshotsDir, { recursive: true });
  }

  private computeHunks(oldContent: string, newContent: string): { hunks: DiffHunk[]; summary: { linesAdded: number; linesRemoved: number } } {
    const changes = diffLines(oldContent, newContent);
    const hunks: DiffHunk[] = [];
    let newOffset = 0;
    let oldOffset = 0;
    let linesAdded = 0;
    let linesRemoved = 0;

    for (const part of changes) {
      if (part.added) {
        hunks.push({ type: 'added', value: part.value, newOffset, oldOffset });
        linesAdded += part.count ?? 0;
        newOffset += part.value.length;
      } else if (part.removed) {
        hunks.push({ type: 'removed', value: part.value, newOffset, oldOffset });
        linesRemoved += part.count ?? 0;
        oldOffset += part.value.length;
      } else {
        newOffset += part.value.length;
        oldOffset += part.value.length;
      }
    }

    return { hunks, summary: { linesAdded, linesRemoved } };
  }

  /**
   * Sync the cached copy to the current file content on startup.
   * Always overwrites so that a crash mid-write doesn't leave a stale cache.
   */
  initBaseline(content: string): void {
    fs.writeFileSync(this.cachedPath, content, 'utf-8');
    if (!fs.existsSync(this.versionsPath)) {
      fs.writeFileSync(this.versionsPath, '[]', 'utf-8');
    }
  }

  /**
   * Record a change by diffing old vs new content.
   * Returns a VersionEntry if there was a meaningful change, null otherwise.
   */
  recordChange(oldContent: string, newContent: string): VersionEntry | null {
    if (oldContent === newContent) return null;

    // Deduplicate: if the new content already matches the cached copy on disk,
    // this is a spurious event (e.g., chokidar double-fire or server restart).
    try {
      const cached = fs.readFileSync(this.cachedPath, 'utf-8');
      if (cached === newContent) return null;
    } catch { /* no cached copy yet, proceed */ }

    const { hunks, summary } = this.computeHunks(oldContent, newContent);
    if (hunks.length === 0) return null;
    const { linesAdded, linesRemoved } = summary;

    const now = new Date();
    const versions = this.getVersions();
    const latest = versions.length > 0 ? versions[versions.length - 1] : null;
    const latestAge = latest ? now.getTime() - new Date(latest.timestamp).getTime() : Infinity;

    // Coalesce: if the latest version is <5s old, update it in place
    // by re-diffing from its original snapshot to the new content.
    if (latest && latestAge < 5000) {
      const snapshotPath = path.join(this.snapshotsDir, `${latest.id}.md`);
      let snapshotContent: string | null = null;
      try { snapshotContent = fs.readFileSync(snapshotPath, 'utf-8'); } catch { /* missing */ }

      if (snapshotContent !== null) {
        const coalesced = this.computeHunks(snapshotContent, newContent);
        latest.timestamp = now.toISOString();
        latest.hunks = coalesced.hunks;
        latest.summary = coalesced.summary;
        fs.writeFileSync(this.versionsPath, JSON.stringify(versions, null, 2), 'utf-8');
        fs.writeFileSync(this.cachedPath, newContent, 'utf-8');
        return latest;
      }
    }

    const id = crypto.randomUUID();

    // Save snapshot of the content BEFORE this version was applied.
    // Ensure directory exists (may have been cleared externally).
    fs.mkdirSync(this.snapshotsDir, { recursive: true });
    fs.writeFileSync(path.join(this.snapshotsDir, `${id}.md`), oldContent, 'utf-8');

    const version: VersionEntry = {
      id,
      timestamp: now.toISOString(),
      hunks,
      summary,
    };

    // Clean up snapshot files for versions being dropped
    while (versions.length >= MAX_VERSIONS) {
      const dropped = versions.shift()!;
      const snapshotPath = path.join(this.snapshotsDir, `${dropped.id}.md`);
      try { fs.unlinkSync(snapshotPath); } catch { /* already gone */ }
    }

    versions.push(version);
    fs.writeFileSync(this.versionsPath, JSON.stringify(versions, null, 2), 'utf-8');

    // Update cached copy
    fs.writeFileSync(this.cachedPath, newContent, 'utf-8');

    return version;
  }

  /**
   * Compute a cumulative diff: the difference between the document state
   * just before versionId was applied and the current document content.
   * This shows all changes from that point to now.
   */
  getCumulativeDiff(versionId: string, currentContent: string): DiffHunk[] | null {
    const snapshotPath = path.join(this.snapshotsDir, `${versionId}.md`);
    if (!fs.existsSync(snapshotPath)) return null;

    const oldContent = fs.readFileSync(snapshotPath, 'utf-8');
    if (oldContent === currentContent) return [];
    return this.computeHunks(oldContent, currentContent).hunks;
  }

  /**
   * Get the document content as it looked AFTER a version was applied.
   * This is the next version's "before" snapshot, or the current content for the latest.
   */
  getContentAfterVersion(versionId: string, currentContent: string): string | null {
    const versions = this.getVersions();
    const idx = versions.findIndex((v) => v.id === versionId);
    if (idx === -1) return null;

    // If this is the latest version, the "after" state is the current content
    if (idx === versions.length - 1) return currentContent;

    // Otherwise, the "after" state is the next version's "before" snapshot
    const nextVersion = versions[idx + 1];
    const snapshotPath = path.join(this.snapshotsDir, `${nextVersion.id}.md`);
    try {
      return fs.readFileSync(snapshotPath, 'utf-8');
    } catch {
      return null;
    }
  }

  getVersions(): VersionEntry[] {
    try {
      const raw = fs.readFileSync(this.versionsPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  getLastEdited(): string | null {
    const versions = this.getVersions();
    if (versions.length === 0) return null;
    return versions[versions.length - 1].timestamp;
  }
}
