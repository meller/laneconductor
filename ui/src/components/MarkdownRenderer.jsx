import React, { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({ breaks: true });

export function MarkdownRenderer({ content, className = '' }) {
  const html = useMemo(() => (content ? marked(content) : ''), [content]);

  if (!content) {
    return <p className="text-gray-500 text-sm italic">No content available.</p>;
  }

  return (
    <div
      className={`markdown prose prose-invert prose-sm max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
