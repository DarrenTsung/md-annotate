import { useCallback, useEffect, useState } from 'react';
import type { Annotation } from '@shared/types.js';

/**
 * Timestamp of the most recent activity on a thread — the last comment's
 * creation time, falling back to the annotation's updatedAt. Used to decide
 * whether a thread has changed since the user last looked at it.
 */
export function lastActivityOf(annotation: Annotation): number {
  const last = annotation.comments[annotation.comments.length - 1];
  return new Date(last?.createdAt ?? annotation.updatedAt).getTime();
}

type ViewedMap = Record<string, number>;

function storageKey(filePath: string): string {
  return `md-annotate:viewed:${filePath}`;
}

function load(filePath: string): ViewedMap {
  try {
    const raw = localStorage.getItem(storageKey(filePath));
    return raw ? (JSON.parse(raw) as ViewedMap) : {};
  } catch {
    return {};
  }
}

interface UseViewedThreadsResult {
  /** True when the thread has activity newer than the last time it was viewed. */
  isUnread: (annotation: Annotation) => boolean;
  /** Record that the user has seen the thread's current state. */
  markViewed: (annotation: Annotation) => void;
}

/**
 * Tracks, per file, the last-viewed timestamp for each annotation thread in
 * localStorage. A thread is "unread" when its latest activity is newer than
 * the last time the user viewed it (or it has never been viewed).
 */
export function useViewedThreads(filePath: string): UseViewedThreadsResult {
  const [viewed, setViewed] = useState<ViewedMap>(() => load(filePath));

  // Reload when the file changes.
  useEffect(() => {
    setViewed(load(filePath));
  }, [filePath]);

  const persist = useCallback(
    (next: ViewedMap) => {
      try {
        localStorage.setItem(storageKey(filePath), JSON.stringify(next));
      } catch {
        // Ignore quota / availability errors — viewed state is best-effort.
      }
    },
    [filePath]
  );

  const isUnread = useCallback(
    (annotation: Annotation): boolean => {
      const seenAt = viewed[annotation.id];
      if (seenAt === undefined) return true;
      return lastActivityOf(annotation) > seenAt;
    },
    [viewed]
  );

  const markViewed = useCallback(
    (annotation: Annotation) => {
      const activity = lastActivityOf(annotation);
      setViewed((prev) => {
        if (prev[annotation.id] !== undefined && prev[annotation.id] >= activity) {
          return prev;
        }
        const next = { ...prev, [annotation.id]: activity };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  return { isUnread, markViewed };
}
