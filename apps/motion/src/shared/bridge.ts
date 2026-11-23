export interface RuntimeVersions {
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
}

export type OrbState = 'signed-out' | 'idle' | 'reading';

export interface OrbControls {
  beginDrag(): void;
  endDrag(): void;
  click(): void;
  drop(): void;
  onState(listener: (state: OrbState) => void): () => void;
}

export type SignedInState = { status: 'signed-out' } | { status: 'signed-in'; email: string };

export type SignInFailure =
  'credentials' | 'unavailable' | 'invalid' | 'cancelled' | 'account-exists' | 'refused';

export type SignInResult =
  { ok: true; state: SignedInState } | { ok: false; reason: SignInFailure };

export interface AuthControls {
  state(): Promise<SignedInState>;
  signIn(email: string, password: string): Promise<SignInResult>;
  signInWithGoogle(): Promise<SignInResult>;
  signOut(): Promise<SignedInState>;
  onChange(listener: (state: SignedInState) => void): () => void;
}

export type ReadingKind = 'text' | 'value' | 'name';

export type ReadingSource = 'dom' | 'accessibility' | 'screenshot';

export interface Reading {
  readonly source: ReadingSource;
  readonly kind: ReadingKind;
  readonly control: string;
  readonly text: string;
}

export type ReadFailure = 'nothing' | 'protected' | 'unsupported' | 'timeout' | 'failed';

export type ReadOutcome = { ok: true; reading: Reading } | { ok: false; reason: ReadFailure };

export type ReadScope = 'point' | 'page' | 'focus';

export type ImageScope = Exclude<ReadScope, 'focus'>;

export interface PanelContent {
  readonly scope: ReadScope;
  readonly app: string | null;
  readonly outcome: ReadOutcome;
}

export type FixFailure =
  'nothing' | 'signed-out' | 'outdated' | 'refused' | 'unavailable' | 'timeout';

export interface Proposal {
  readonly replacement: string;
  readonly engine: string;
  readonly fallback: boolean;
}

export type ProposalOutcome = { ok: true; proposal: Proposal } | { ok: false; reason: FixFailure };

export const undoWindow = 30_000;

export type ApplyFailure = 'nothing' | 'moved' | 'unsupported' | 'blocked' | 'failed';

export type ApplyOutcome =
  { ok: true; verified: boolean; undoUntil: number } | { ok: false; reason: ApplyFailure };

export type UndoFailure = 'expired' | 'changed' | 'blocked' | 'failed';

export type UndoOutcome = { ok: true } | { ok: false; reason: UndoFailure };

export interface PanelControls {
  current(): Promise<PanelContent | null>;
  onContent(listener: (content: PanelContent) => void): () => void;
  close(): void;
  fix(instruction: string): Promise<ProposalOutcome>;
  copy(text: string): void;
  apply(): Promise<ApplyOutcome>;
  undo(): Promise<UndoOutcome>;
}

export interface SiferBridge {
  readonly versions: RuntimeVersions;
  readonly orb: OrbControls;
  readonly auth: AuthControls;
  readonly panel: PanelControls;
}

export const orbClickChannel = 'sifer:orb-click';
export const orbDropChannel = 'sifer:orb-drop';
export const panelCurrentChannel = 'sifer:panel-current';
export const panelContentChannel = 'sifer:panel-content';
export const panelCloseChannel = 'sifer:panel-close';
export const panelFixChannel = 'sifer:panel-fix';
export const panelCopyChannel = 'sifer:panel-copy';
export const panelApplyChannel = 'sifer:panel-apply';
export const panelUndoChannel = 'sifer:panel-undo';
export const orbStateChannel = 'sifer:orb-state';
export const authStateChannel = 'sifer:auth-state';
export const authSignInChannel = 'sifer:auth-sign-in';
export const authSignOutChannel = 'sifer:auth-sign-out';
export const authGoogleChannel = 'sifer:auth-google';
export const authChangedChannel = 'sifer:auth-changed';
export const orbDragBeginChannel = 'sifer:orb-drag-begin';
export const orbDragEndChannel = 'sifer:orb-drag-end';
