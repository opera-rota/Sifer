import type { PanelContent, ReadOutcome, ReadScope } from '../../shared/bridge';
import { appName } from '../../shared/context';
import type { Point } from '../drag';
import type { DipRect } from './capture';
import { ownedByExtension, settled } from './chain';
import type { FocusReading, WindowFrame, WindowInfo } from './protocol';

export interface FocusDependencies {
  foreground(): Promise<WindowInfo | null>;
  extensionBrowser(): string | null;
  dom(dip: Point, title: string, scope: ReadScope): Promise<ReadOutcome | null>;
  focused(): Promise<FocusReading>;
  toDip(physical: WindowFrame): DipRect;
}

export interface FocusedContent {
  readonly content: PanelContent;
  readonly anchor: DipRect | null;
}

export function centreOf(rect: DipRect): Point {
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
}

export function createFocusRead(dependencies: FocusDependencies) {
  return async (): Promise<FocusedContent | null> => {
    const window = await dependencies.foreground();
    if (!window || window.shell) {
      return null;
    }
    const app = appName(window.process);
    const frame = window.frame ? dependencies.toDip(window.frame) : null;
    const answer = (outcome: ReadOutcome, anchor: DipRect | null): FocusedContent => ({
      content: { scope: 'focus', app, outcome },
      anchor,
    });
    if (frame && ownedByExtension(window, dependencies.extensionBrowser())) {
      const outcome = await dependencies.dom(centreOf(frame), window.title, 'focus');
      if (outcome && (outcome.ok || outcome.reason === 'protected')) {
        return answer(outcome, null);
      }
    }
    const focused = await dependencies.focused();
    if (!settled(focused.outcome)) {
      return null;
    }
    return answer(focused.outcome, focused.bounds ? dependencies.toDip(focused.bounds) : null);
  };
}

export type FocusRead = ReturnType<typeof createFocusRead>;
