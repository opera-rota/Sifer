import { useEffect, useRef, useState, type FormEvent } from 'react';
import '@fontsource-variable/exo-2';
import {
  undoWindow,
  type ApplyFailure,
  type FixFailure,
  type PanelContent,
  type Proposal,
  type ReadFailure,
  type Reading,
  type ReadingKind,
  type ReadScope,
  type UndoFailure,
} from '../../shared/bridge';
import { canWrite } from '../../shared/context';
import { Aurora } from './Aurora';
import { ContextPreview } from './ContextPreview';
import { Caution, Check, Close, CopyMark, Rewind, Sparkle, UndoArrow, WriteIn } from './Glyphs';
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

const applyFailureText: Record<ApplyFailure, string> = {
  nothing: 'There is nothing to write.',
  moved: 'The text changed since Sifer read it. Drop the orb on it again.',
  unsupported: 'Sifer cannot write into this app yet. Copy the text instead.',
  blocked: 'Windows kept the app in the background. Click it once, then Apply again.',
  failed: 'Sifer could not write the text. Copy it instead.',
};

const undoFailureText: Record<UndoFailure, string> = {
  expired: 'The undo window has closed. Use Ctrl+Z in the app.',
  changed: 'The text was edited after Sifer wrote it, so Sifer left it alone.',
  blocked: 'Windows kept the app in the background. Use Ctrl+Z in the app.',
  failed: 'Sifer could not undo. Use Ctrl+Z in the app.',
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

interface Note {
  readonly text: string;
  readonly tone: 'info' | 'error';
}

type Write =
  | { stage: 'ready'; note?: Note }
  | { stage: 'writing' }
  | { stage: 'written'; verified: boolean; undoUntil: number; note?: Note }
  | { stage: 'undoing'; verified: boolean; undoUntil: number };

type Fix =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'proposed'; proposal: Proposal; write: Write }
  | { status: 'failed'; reason: FixFailure };

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

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
  const write = fix.status === 'proposed' ? fix.write : null;
  const counting = write?.stage === 'written' || write?.stage === 'undoing';
  const now = useNow(counting);
  const undoUntil = counting ? write.undoUntil : 0;
  const secondsLeft = Math.max(0, Math.ceil((undoUntil - now) / 1000));
  const writable = content !== null && canWrite(content);
  const appLabel = content?.app ?? 'the app';

  const updateWrite = (asked: number, next: Write): void => {
    if (generation.current !== asked) {
      return;
    }
    setFix((current) => (current.status === 'proposed' ? { ...current, write: next } : current));
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const text = instruction.trim();
    if (text === '' || working || write?.stage === 'writing') {
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
          ? { status: 'proposed', proposal: result.proposal, write: { stage: 'ready' } }
          : { status: 'failed', reason: result.reason },
      );
    });
  };

  const apply = (): void => {
    const asked = generation.current;
    updateWrite(asked, { stage: 'writing' });
    void window.sifer.panel
      .apply()
      .then((result) =>
        updateWrite(
          asked,
          result.ok
            ? { stage: 'written', verified: result.verified, undoUntil: result.undoUntil }
            : { stage: 'ready', note: { text: applyFailureText[result.reason], tone: 'error' } },
        ),
      );
  };

  const undo = (written: Extract<Write, { stage: 'written' }>): void => {
    const asked = generation.current;
    updateWrite(asked, {
      stage: 'undoing',
      verified: written.verified,
      undoUntil: written.undoUntil,
    });
    void window.sifer.panel
      .undo()
      .then((result) =>
        updateWrite(
          asked,
          result.ok
            ? { stage: 'ready', note: { text: `Original restored in ${appLabel}.`, tone: 'info' } }
            : { ...written, note: { text: undoFailureText[result.reason], tone: 'error' } },
        ),
      );
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
        {fix.status === 'proposed' && write && (
          <>
            {(write.stage === 'ready' || write.stage === 'writing') && (
              <div className="panel-proposal-head">
                <Sparkle className="panel-label-mark" />
                <span className="panel-label">
                  Suggested{fix.proposal.fallback ? ' (backup model)' : ''}
                </span>
                {writable && (
                  <button
                    type="button"
                    className={write.stage === 'writing' ? 'panel-apply working' : 'panel-apply'}
                    disabled={write.stage === 'writing'}
                    onClick={apply}
                  >
                    <WriteIn />
                    {write.stage === 'writing' ? 'Writing' : 'Apply'}
                  </button>
                )}
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
                  disabled={write.stage === 'writing'}
                  onClick={() => setFix({ status: 'idle' })}
                >
                  <Rewind />
                  Original
                </button>
              </div>
            )}
            {(write.stage === 'written' || write.stage === 'undoing') && (
              <>
                <div className="panel-proposal-head">
                  {write.verified ? (
                    <Check className="panel-label-mark" />
                  ) : (
                    <Caution className="panel-label-mark caution" />
                  )}
                  <span className={write.verified ? 'panel-label' : 'panel-label caution'}>
                    {write.verified ? `Applied in ${appLabel}` : 'Not confirmed'}
                  </span>
                  {secondsLeft > 0 && (
                    <button
                      type="button"
                      className="panel-action panel-undo"
                      disabled={write.stage === 'undoing'}
                      onClick={() => write.stage === 'written' && undo(write)}
                    >
                      <UndoArrow />
                      {write.stage === 'undoing' ? 'Undoing' : `Undo ${secondsLeft}s`}
                    </button>
                  )}
                  <button
                    type="button"
                    className="panel-action"
                    onClick={() => window.sifer.panel.copy(fix.proposal.replacement)}
                  >
                    <CopyMark />
                    Copy
                  </button>
                </div>
                {secondsLeft > 0 && (
                  <div className="panel-timer" aria-hidden="true">
                    <span
                      style={{ width: `${Math.min(100, ((undoUntil - now) / undoWindow) * 100)}%` }}
                    />
                  </div>
                )}
                {!write.verified && (
                  <p className="panel-caution">
                    Sifer wrote the text but could not read it back. Check {appLabel}, or copy it
                    from here.
                  </p>
                )}
              </>
            )}
            <p className="panel-text panel-proposal">{fix.proposal.replacement}</p>
            {'note' in write && write.note && (
              <p className={`panel-write-note ${write.note.tone}`}>{write.note.text}</p>
            )}
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
