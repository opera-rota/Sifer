import type { PanelContent } from '../shared/bridge';
import { frameInterval, type Point } from './drag';

export const hideSettle = 50;
export const hideDelay = frameInterval + hideSettle;
export const panelSettle = 6 * frameInterval;

export interface DropDependencies {
  hide(): boolean;
  restore(): void;
  wait(milliseconds: number): Promise<void>;
  read(point: Point): Promise<PanelContent>;
}

export function dropPoint(orb: { x: number; y: number; width: number; height: number }): Point {
  return { x: Math.round(orb.x + orb.width / 2), y: Math.round(orb.y + orb.height / 2) };
}

export function createDropReader(dependencies: DropDependencies) {
  let busy = false;

  return {
    get busy(): boolean {
      return busy;
    },
    async read(point: Point): Promise<PanelContent | null> {
      if (busy) {
        return null;
      }
      busy = true;
      const panelWasOpen = dependencies.hide();
      try {
        await dependencies.wait(hideDelay + (panelWasOpen ? panelSettle : 0));
        return await dependencies.read(point);
      } catch {
        return { scope: 'point', app: null, outcome: { ok: false, reason: 'failed' } };
      } finally {
        dependencies.restore();
        busy = false;
      }
    },
  };
}
