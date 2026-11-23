import type { ReactNode } from 'react';

interface GlyphProps {
  className?: string | undefined;
}

function Glyph({ children, className }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      className={className ? `glyph ${className}` : 'glyph'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Envelope = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </Glyph>
);

export const Lock = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <path d="M12 14.5v2" />
  </Glyph>
);

export const Eye = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Glyph>
);

export const EyeOff = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5c2 0 3.7.7 5.1 1.7M21.5 12s-3.5 6.5-9.5 6.5c-2 0-3.7-.7-5.1-1.7" />
    <path d="M9.9 14.1a3 3 0 0 0 4.2-4.2" />
    <path d="m4 20 16-16" />
  </Glyph>
);

export const SignInArrow = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    <path d="m9 8 4 4-4 4" />
    <path d="M13 12H3" />
  </Glyph>
);

export const Chevron = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <path d="m9 6 6 6-6 6" />
  </Glyph>
);

export const Shield = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Glyph>
);

export const SignOutArrow = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
    <path d="m15 8 4 4-4 4" />
    <path d="M19 12H9" />
  </Glyph>
);

export function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export const Sparkle = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9z" />
  </Glyph>
);

export const CopyMark = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Glyph>
);

export const Rewind = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v4.5h4.5" />
  </Glyph>
);

export const Close = ({ className }: GlyphProps) => (
  <Glyph className={className}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Glyph>
);
