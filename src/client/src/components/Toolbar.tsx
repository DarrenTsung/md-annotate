import React from 'react';

interface ToolbarProps {
  filePath: string;
  claudeConnected: boolean;
}

export function Toolbar({ filePath, claudeConnected }: ToolbarProps) {
  const fileName = filePath.split('/').pop() || filePath;

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <span className="toolbar-logo">md-annotate</span>
        <span className="toolbar-separator">/</span>
        <span className="toolbar-filename" title={filePath}>
          {fileName}
        </span>
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
