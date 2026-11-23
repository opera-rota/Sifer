import type { PanelContent, Reading, ReadingSource, ReadScope } from './bridge';

export type Confidence = 'high' | 'medium' | 'low';

const knownApps: Readonly<Record<string, string>> = {
  'acrobat.exe': 'Acrobat',
  'acrord32.exe': 'Acrobat Reader',
  'brave.exe': 'Brave',
  'chrome.exe': 'Chrome',
  'code.exe': 'VS Code',
  'discord.exe': 'Discord',
  'excel.exe': 'Excel',
  'explorer.exe': 'File Explorer',
  'firefox.exe': 'Firefox',
  'ms-teams.exe': 'Teams',
  'msedge.exe': 'Edge',
  'msedgewebview2.exe': 'Web view',
  'notepad.exe': 'Notepad',
  'olk.exe': 'Outlook',
  'onenote.exe': 'OneNote',
  'outlook.exe': 'Outlook',
  'powerpnt.exe': 'PowerPoint',
  'slack.exe': 'Slack',
  'teams.exe': 'Teams',
  'windowsterminal.exe': 'Terminal',
  'winword.exe': 'Word',
};

export const readerText: Record<ReadingSource, string> = {
  dom: 'Page reader',
  accessibility: 'Accessibility',
  screenshot: 'Screenshot',
};

export const confidenceText: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export function appName(process: string): string | null {
  const name = process.trim().toLowerCase();
  if (name === '') {
    return null;
  }
  const known = knownApps[name];
  if (known) {
    return known;
  }
  const bare = name.endsWith('.exe') ? name.slice(0, -4) : name;
  return bare === '' ? null : bare.charAt(0).toUpperCase() + bare.slice(1);
}

export function confidenceOf(scope: ReadScope, reading: Reading): Confidence {
  switch (reading.source) {
    case 'dom':
      return 'high';
    case 'accessibility':
      return reading.kind === 'name' ? 'medium' : 'high';
    case 'screenshot':
      return scope === 'point' ? 'medium' : 'low';
  }
}

export function canWrite(content: PanelContent): boolean {
  return (
    content.scope === 'point' &&
    content.outcome.ok &&
    content.outcome.reading.source === 'accessibility' &&
    content.outcome.reading.kind === 'text'
  );
}
