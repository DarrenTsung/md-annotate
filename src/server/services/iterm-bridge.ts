import { execFile } from 'child_process';
import type { Annotation } from '../../shared/types.js';

interface SessionQueue {
  timer: ReturnType<typeof setTimeout> | null;
  pending: Array<{ annotation: Annotation; filePath: string; sidecarPath: string }>;
}

export class ItermBridge {
  private queues = new Map<string, SessionQueue>();
  private onSent?: (ids: string[]) => void;

  constructor(onSent?: (ids: string[]) => void) {
    this.onSent = onSent;
  }

  /**
   * Queue an annotation to be sent to a specific iTerm session.
   * Debounces with a 2.5s window per session.
   */
  queueAnnotation(
    sessionId: string,
    annotation: Annotation,
    filePath: string,
    sidecarPath: string
  ): void {
    const uuid = this.extractUuid(sessionId);
    if (!uuid) return;

    let queue = this.queues.get(uuid);
    if (!queue) {
      queue = { timer: null, pending: [] };
      this.queues.set(uuid, queue);
    }

    queue.pending.push({ annotation, filePath, sidecarPath });

    if (queue.timer) {
      clearTimeout(queue.timer);
    }

    queue.timer = setTimeout(() => {
      this.flush(uuid);
    }, 2500);
  }

  isSessionReachable(sessionId: string): boolean {
    const uuid = this.extractUuid(sessionId);
    return uuid !== null;
  }

  private extractUuid(sessionId: string): string | null {
    return sessionId.split(':')[1] || null;
  }

  private flush(uuid: string): void {
    const queue = this.queues.get(uuid);
    if (!queue || queue.pending.length === 0) return;

    const items = [...queue.pending];
    queue.pending = [];
    queue.timer = null;

    // Group by file
    const byFile = new Map<string, { annotations: Annotation[]; sidecarPath: string }>();
    for (const item of items) {
      let group = byFile.get(item.filePath);
      if (!group) {
        group = { annotations: [], sidecarPath: item.sidecarPath };
        byFile.set(item.filePath, group);
      }
      group.annotations.push(item.annotation);
    }

    // Format and send one message per file
    for (const [filePath, { annotations, sidecarPath }] of byFile) {
      const message = this.formatMessage(annotations, filePath, sidecarPath);
      this.sendToIterm(uuid, message);
    }

    const ids = items.map((i) => i.annotation.id);
    this.onSent?.(ids);
  }

  private formatMessage(
    annotations: Annotation[],
    filePath: string,
    _sidecarPath: string
  ): string {
    const fileName = filePath.split('/').pop();
    const count = annotations.length;
    const noun = count === 1 ? 'comment' : 'comments';
    return `[md-annotate] ${count} new review ${noun} on ${fileName} — run \`md-annotate next\` to review`;
  }

  private sendToIterm(uuid: string, message: string): void {
    const escaped = message
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');

    const script = `
tell application "iTerm"
    repeat with aWindow in windows
        tell aWindow
            repeat with aTab in tabs
                tell aTab
                    repeat with aSession in sessions
                        if unique ID of aSession is "${uuid}" then
                            tell aSession
                                write text "${escaped}" newline NO
                                write text ""
                            end tell
                            return
                        end if
                    end repeat
                end tell
            end repeat
        end tell
    end repeat
end tell`;

    execFile('osascript', ['-e', script], (error) => {
      if (error) {
        console.error(`Failed to send to iTerm session ${uuid}:`, error.message);
      } else {
        console.log(
          `Sent ${message.split('\n').length} lines to Claude via iTerm (${uuid.slice(0, 8)}...)`
        );
      }
    });
  }
}
