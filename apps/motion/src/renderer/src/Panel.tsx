import { useEffect, useState } from 'react';
import type {
  PanelContent,
  ReadFailure,
  ReadingKind,
  ReadingSource,
  ReadScope,
} from '../../shared/bridge';
import './panel.css';

const failureText: Record<ReadFailure, string> = {
  nothing: 'Nothing readable under the orb.',
  protected: 'That field is protected, so Sifer did not read it.',
  unsupported: 'Reading the screen is not available on this system yet.',
  timeout: 'The app under the orb did not answer in time.',
  failed: 'Sifer could not read that spot.',
};

const sourceText: Record<ReadingSource, string> = {
  dom: 'from the page',
  accessibility: 'from the app',
  screenshot: 'from a screenshot',
};

const kindText: Record<ReadingKind, string> = {
  text: 'Paragraph',
  value: 'Field value',
  name: 'Label',
};

const titleText: Record<ReadScope, string> = {
  point: 'Under the orb',
  page: 'Whole page',
};

const close = (): void => window.sifer.panel.close();
const separator = ` ${String.fromCharCode(183)} `;
const closeMark = String.fromCharCode(215);

export function Panel() {
  const [content, setContent] = useState<PanelContent | null>(null);

  useEffect(() => {
    let active = true;
    void window.sifer.panel.current().then((current) => {
      if (active && current) {
        setContent(current);
      }
    });
    const unsubscribe = window.sifer.panel.onContent(setContent);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const outcome = content?.outcome ?? null;
  const scope = content?.scope ?? 'point';

  return (
    <main className="panel">
      <header className="panel-header">
        <span className="panel-title">{titleText[scope]}</span>
        {outcome?.ok && (
          <span className="panel-source">
            {scope === 'page' ? outcome.reading.control : kindText[outcome.reading.kind]}
            {scope === 'point' && separator}
            {scope === 'point' && outcome.reading.control}
          </span>
        )}
        <button type="button" className="panel-close" aria-label="Close" onClick={close}>
          {closeMark}
        </button>
      </header>
      <section className="panel-body" aria-live="polite">
        {outcome === null && <p className="panel-note">Drop the orb on any text.</p>}
        {outcome?.ok === false && <p className="panel-note">{failureText[outcome.reason]}</p>}
        {outcome?.ok && <p className="panel-text">{outcome.reading.text}</p>}
      </section>
      {outcome?.ok && (
        <footer className="panel-footer">
          {outcome.reading.text.length.toLocaleString()} characters
          {separator}
          {sourceText[outcome.reading.source]}
        </footer>
      )}
    </main>
  );
}
