import React, { useState, useEffect } from 'react';
import type { VersionEntry } from '@shared/types.js';

interface ToolbarProps {
  filePath: string;
  claudeConnected: boolean;
  lastEdited: string | null;
  versions: VersionEntry[];
  activeVersionId: string | null;
  autoShowVersionId: string | null;
  onSetActiveVersion: (id: string | null) => void;
}

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Toolbar({
  filePath,
  claudeConnected,
  lastEdited,
  versions,
  activeVersionId,
  autoShowVersionId,
  onSetActiveVersion,
}: ToolbarProps) {
  const fileName = filePath.split('/').pop() || filePath;
  const [, setTick] = useState(0);

  // Update relative time every 10s
  useEffect(() => {
    if (!lastEdited) return;
    const interval = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(interval);
  }, [lastEdited]);

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <span className="toolbar-logo">md-annotate</span>
        <span className="toolbar-separator">/</span>
        <span className="toolbar-filename" title={filePath}>
          {fileName}
        </span>
        {lastEdited && (
          <>
            <span className="toolbar-separator">·</span>
            <span className="last-edited">Edited {formatRelativeTime(lastEdited)}</span>
          </>
        )}
        {versions.length > 0 && (
          <div className="toolbar-versions">
            {versions.slice(-20).map((v) => (
              <span
                key={v.id}
                className={`version-dot${v.id === autoShowVersionId ? ' auto-show' : ''}${v.id === activeVersionId ? ' active' : ''}`}
                title={`${new Date(v.timestamp).toLocaleTimeString()} — +${v.summary.linesAdded}/-${v.summary.linesRemoved} lines`}
                onMouseEnter={() => onSetActiveVersion(v.id)}
                onMouseLeave={() => onSetActiveVersion(null)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="toolbar-right">
        <span
          className={`claude-status ${claudeConnected ? 'connected' : 'disconnected'}`}
          title={
            claudeConnected
              ? 'Connected to Claude Code via iTerm'
              : 'Not connected to Claude Code (no ITERM_SESSION_ID)'
          }
        >
          <span className="status-dot" />
          {claudeConnected ? 'Claude connected' : 'Claude disconnected'}
        </span>
      </div>
    </header>
  );
}
