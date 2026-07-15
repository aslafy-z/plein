import { useState } from 'react';
import { C } from '../theme';
import { brandIconSrc } from '../lib/brandIcons';

/**
 * Station avatar: the brand's favicon on a white tile when we have one,
 * otherwise the two-letter initials on the usual dark tile. `label` may be
 * the brand or the full display name (favorites only persist the name).
 */
export default function BrandAvatar({
  label,
  init,
  size,
  fontSize,
}: {
  label: string | undefined;
  init: string;
  size: number;
  fontSize: number;
}) {
  const src = brandIconSrc(label);
  // A missing/corrupt icon file falls back to initials; keyed by src so a
  // failure for one brand doesn't stick when the row is recycled for another.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showIcon = src != null && failedSrc !== src;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: showIcon ? '#fff' : C.surface3,
        color: C.mut,
        fontWeight: 800,
        fontSize,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {showIcon ? (
        <img
          src={src}
          alt=""
          width={Math.round(size * 0.66)}
          height={Math.round(size * 0.66)}
          style={{ objectFit: 'contain' }}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        init
      )}
    </div>
  );
}
