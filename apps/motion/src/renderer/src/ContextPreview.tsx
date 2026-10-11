import type { PanelContent } from '../../shared/bridge';
import { confidenceOf, confidenceText, readerText } from '../../shared/context';

export function ContextPreview({ content }: { content: PanelContent }) {
  const { app, outcome, scope } = content;
  if (!outcome.ok && app === null) {
    return null;
  }
  const confidence = outcome.ok ? confidenceOf(scope, outcome.reading) : null;
  return (
    <ul className="context" aria-label="Reading context">
      {app !== null && <li className="context-chip context-app">{app}</li>}
      {outcome.ok && <li className="context-chip">{readerText[outcome.reading.source]}</li>}
      {confidence !== null && (
        <li className={`context-chip context-${confidence}`}>{confidenceText[confidence]}</li>
      )}
    </ul>
  );
}
