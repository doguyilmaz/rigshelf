export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 20V4h10a4 4 0 0 1 0 8H9m5 0 5 8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="square"
        strokeLinejoin="round"
      />
      <path d="M9 16h4" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}
