export function Aurora() {
  return (
    <svg className="aurora" viewBox="0 0 480 720" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="aurora-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2ef2d8" stopOpacity="0" />
          <stop offset="0.45" stopColor="#2ef2d8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#7dfff0" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="aurora-floor" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1de9b6" stopOpacity="0" />
          <stop offset="0.35" stopColor="#1de9b6" stopOpacity="0.7" />
          <stop offset="0.7" stopColor="#3cf0ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#3cf0ff" stopOpacity="0" />
        </linearGradient>
        <filter id="aurora-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <path
        className="aurora-arc"
        d="M-40 300 C 20 120, 180 30, 420 0"
        stroke="url(#aurora-arc)"
        strokeWidth="2"
        fill="none"
        filter="url(#aurora-blur)"
      />
      <path
        className="aurora-arc slow"
        d="M-30 360 C 40 170, 200 60, 470 30"
        stroke="url(#aurora-arc)"
        strokeWidth="1"
        fill="none"
      />
      <path
        className="aurora-floor"
        d="M-20 705 C 120 668, 300 690, 500 640"
        stroke="url(#aurora-floor)"
        strokeWidth="2.5"
        fill="none"
        filter="url(#aurora-blur)"
      />
      <path
        className="aurora-floor slow"
        d="M-20 712 C 150 690, 320 700, 500 672"
        stroke="url(#aurora-floor)"
        strokeWidth="1"
        fill="none"
      />
    </svg>
  );
}
