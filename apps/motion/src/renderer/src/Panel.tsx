import { useEffect, useRef, useState, type FormEvent } from 'react';
import '@fontsource-variable/exo-2';
import type {
  FixFailure,
  PanelContent,
  Proposal,
  ReadFailure,
  Reading,
  ReadingKind,
  ReadScope,
} from '../../shared/bridge';
import { Aurora } from './Aurora';
import { ContextPreview } from './ContextPreview';
import { Close, CopyMark, Rewind, Sparkle } from './Glyphs';
import brand from './assets/brand.png';
import mantis from './assets/mantis.webp';
import './panel.css';

const failureText: Record<ReadFailure, string> = {
  nothing: 'Nothing readable under the orb.',
  protected: 'That field is protected, so Sifer did not read it.',
  unsupported: 'Reading the screen is not available on this system yet.',
  timeout: 'The app under the orb did not answer in time.',
  failed: 'Sifer could not read that spot.',
};

const fixFailureText: Record<FixFailure, string> = {
  nothing: 'There is no text to work on.',
  'signed-out': 'Sign in first: click the orb.',
  outdated: 'Sifer needs updating.',
  refused: 'Sifer could not use that request.',
  unavailable: 'Sifer could not reach its services. Try again in a moment.',
  timeout: 'Sifer took too long to answer. Try again.',
};

const kindText: Record<ReadingKind, string> = {
  text: 'Paragraph',
  value: 'Field value',
  name: 'Label',
};

const titleText: Record<ReadScope, string> = {
  point: 'Under the orb',
  page: 'Whole page',
  focus: 'Focused field',
};

const defaultInstruction: Record<ReadScope, string> = {
  point: '',
  page: 'summarise this',
  focus: '',
};

type Fix =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'proposed'; proposal: Proposal }
  | { status: 'failed'; reason: FixFailure };

function failureOf(scope: ReadScope, reason: ReadFailure): string {
  return scope === 'focus' && reason === 'nothing'
    ? 'Nothing readable in the focused field.'
    : failureText[reason];
}

const separator = ` ${String.fromCharCode(183)} `;

function sourceOf(scope: ReadScope, reading: Reading): string {
  if (scope === 'page') {
    return reading.control;
  }
  const kind = kindText[reading.kind];
  return reading.control === kind ? kind : `${kind}${separator}${reading.control}`;
}

const close = (): void => window.sifer.panel.close();

export function Panel() {
  const [content, setContent] = useState<PanelContent | null>(null);
  const [instruction, setInstruction] = useState('');
  const [fix, setFix] = useState<Fix>({ status: 'idle' });
  const generation = useRef(0);

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
    generation.current += 1;
    setFix({ status: 'idle' });
    setInstruction(defaultInstruction[content?.scope ?? 'point']);
  }, [content]);

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
  const working = fix.status === 'working';

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const text = instruction.trim();
    if (text === '' || working) {
      return;
    }
    const asked = generation.current;
    setFix({ status: 'working' });
    void window.sifer.panel.fix(text).then((result) => {
      if (generation.current !== asked) {
        return;
      }
      setFix(
        result.ok
          ? { status: 'proposed', proposal: result.proposal }
          : { status: 'failed', reason: result.reason },
      );
    });
  };

  return (
    <main className="panel">
      <Aurora />
      <img className="panel-mantis" src={mantis} alt="" draggable={false} />
      <header className="panel-header">
        <img className="panel-brand" src={brand} alt="" draggable={false} />
        <span className="panel-title">{titleText[scope]}</span>
        {outcome?.ok && <span className="panel-source">{sourceOf(scope, outcome.reading)}</span>}
        <button type="button" className="panel-close" aria-label="Close" onClick={close}>
          <Close />
        </button>
      </header>
      {content && <ContextPreview content={content} />}
      <section className="panel-body" aria-live="polite">
        {outcome === null && <p className="panel-note">Drop the orb on any text.</p>}
        {outcome?.ok === false && <p className="panel-note">{failureOf(scope, outcome.reason)}</p>}
        {outcome?.ok && fix.status !== 'proposed' && (
          <p className="panel-text">{outcome.reading.text}</p>
        )}
        {fix.status === 'proposed' && (
          <>
            <div className="panel-proposal-head">
              <Sparkle className="panel-label-mark" />
              <span className="panel-label">
                Suggested{fix.proposal.fallback ? ' (backup model)' : ''}
              </span>
              <button
                type="button"
                className="panel-action"
                onClick={() => window.sifer.panel.copy(fix.proposal.replacement)}
              >
                <CopyMark />
                Copy
              </button>
              <button
                type="button"
                className="panel-action"
                onClick={() => setFix({ status: 'idle' })}
              >
                <Rewind />
                Original
              </button>
            </div>
            <p className="panel-text panel-proposal">{fix.proposal.replacement}</p>
          </>
        )}
        {fix.status === 'failed' && <p className="panel-error">{fixFailureText[fix.reason]}</p>}
      </section>
      {outcome?.ok && (
        <form className="panel-ask" onSubmit={submit}>
          <input
            className="panel-input"
            aria-label="What should Sifer do?"
            placeholder="make this more professional"
            maxLength={1000}
            value={instruction}
            disabled={working}
            onChange={(event) => setInstruction(event.target.value)}
          />
          <button
            type="submit"
            className={working ? 'panel-send working' : 'panel-send'}
            disabled={working || instruction.trim() === ''}
          >
            <Sparkle />
            <span>{working ? 'Working' : 'Fix'}</span>
          </button>
        </form>
      )}
    </main>
  );
}
