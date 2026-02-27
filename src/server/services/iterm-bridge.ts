import { execFile } from 'child_process';
import type { Annotation } from '../../shared/types.js';

export class ItermBridge {
  private uuid: string | null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingAnnotations: Annotation[] = [];
  private filePath: string;
  private sidecarPath: string;
  private onSent?: (ids: string[]) => void;

  constructor(
    sessionId: string | null,
    filePath: string,
    sidecarPath: string,
    onSent?: (ids: string[]) => void
  ) {
    // Extract UUID from ITERM_SESSION_ID format "w0t0p0:UUID"
    this.uuid = sessionId ? sessionId.split(':')[1] || null : null;
    this.filePath = filePath;
    this.sidecarPath = sidecarPath;
    this.onSent = onSent;
  }

  isConnected(): boolean {
    return this.uuid !== null;
  }

  /**
   * Queue an annotation to be sent to Claude. Debounces with a 2.5s window.
   */
  queueAnnotation(annotation: Annotation): void {
    if (!this.uuid) return;

    this.pendingAnnotations.push(annotation);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, 2500);
  }

  /**
   * Send all pending annotations to Claude immediately.
   */
  private flush(): void {
    if (!this.uuid || this.pendingAnnotations.length === 0) return;

    const annotations = [...this.pendingAnnotations];
    this.pendingAnnotations = [];

    const message = this.formatMessage(annotations);
    this.sendToIterm(message);

    const ids = annotations.map((a) => a.id);
    this.onSent?.(ids);
  }

  private formatMessage(annotations: Annotation[]): string {
    const lines: string[] = [
      `[md-annotate] Review comments on ${this.filePath.split('/').pop()}`,
      `Annotations file: ${this.sidecarPath}`,
      '',
    ];

    for (const annotation of annotations) {
      const comment = annotation.comments[annotation.comments.length - 1];
      if (!comment) continue;

      const selected =
        annotation.selectedText.length > 60
          ? annotation.selectedText.slice(0, 57) + '...'
          : annotation.selectedText;

      lines.push(
        `Line offset ${annotation.startOffset} (id: "${annotation.id}", selected: "${selected}"):`
      );
      lines.push(`> ${comment.text}`);
      lines.push('');
    }

    lines.push(
      "To respond: edit the annotations file directly. Add replies to a comment's"
    );
    lines.push(
      '`comments` array (with author: "claude"). Set status to "resolved" when done.'
    );

    return lines.join('\n');
  }

  private sendToIterm(message: string): void {
    if (!this.uuid) return;

    // Escape the message for AppleScript string
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
                        if unique ID of aSession is "${this.uuid}" then
                            tell aSession to write text "${escaped}"
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
        console.error('Failed to send to iTerm:', error.message);
      } else {
        console.log(
          `Sent ${message.split('\n').length} lines to Claude via iTerm`
        );
      }
    });
  }
}
