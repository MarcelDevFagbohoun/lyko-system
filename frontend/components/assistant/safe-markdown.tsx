import * as React from "react";
import Link from "next/link";
import { parseMarkdown, type Inline } from "@/lib/safe-markdown";

function renderInline(inlines: Inline[], onNavigate?: () => void) {
  return inlines.map((part, i) => {
    switch (part.kind) {
      case "bold":
        return (
          <strong key={i} className="font-semibold text-ink">
            {part.text}
          </strong>
        );
      case "code":
        return (
          <code key={i} className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.85em] text-ink">
            {part.text}
          </code>
        );
      case "link":
        // Toujours une page INTERNE de l'espace (validée par `parseInline`) — jamais d'adresse externe.
        return (
          <Link key={i} href={part.href} onClick={onNavigate} className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover">
            {part.text}
          </Link>
        );
      default:
        return <React.Fragment key={i}>{part.text}</React.Fragment>;
    }
  });
}

/** Réponse de l'assistant : Markdown restreint et sûr (voir `lib/safe-markdown.ts`). */
export function SafeMarkdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const blocks = React.useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="flex flex-col gap-2 text-body-sm leading-relaxed text-ink">
      {blocks.map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={i}>{renderInline(block.inlines, onNavigate)}</p>
        ) : block.ordered ? (
          <ol key={i} className="ml-5 list-decimal space-y-1">
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item, onNavigate)}</li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="ml-5 list-disc space-y-1">
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item, onNavigate)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
