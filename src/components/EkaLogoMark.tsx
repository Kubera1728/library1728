/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface EkaSigmaIconProps {
  className?: string;
}

/**
 * Bold, geometric Greek capital Sigma (Σ) flat-vector mark in solid matte black (#141414).
 */
export const EkaSigmaIcon: React.FC<EkaSigmaIconProps> = ({ className = 'w-6 h-6' }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M14 10H50V20H43.5V16.5H24.5L36.5 32L24.5 47.5H43.5V44H50V54H14V48.5L27.5 32L14 15.5V10Z"
      fill="#0f0f0f"
    />
  </svg>
);

/**
 * Minimalist geometric Greek capital Sigma (Σ) outline mark for clean empty states.
 */
export const EkaSigmaOutlineIcon: React.FC<EkaSigmaIconProps> = ({ className = 'w-10 h-10 text-slate-400' }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M14 10H50V20H43.5V16.5H24.5L36.5 32L24.5 47.5H43.5V44H50V54H14V48.5L27.5 32L14 15.5V10Z"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinejoin="miter"
    />
  </svg>
);

interface EkaWordmarkProps {
  className?: string;
  barClassName?: string;
}

/**
 * Minimal sans-serif "Ekā" wordmark in matte black (#0f0f0f)
 * featuring a solid Classic Red (#E53935) stylized macron bar aligned cleanly above 'a'.
 */
export const EkaWordmark: React.FC<EkaWordmarkProps> = ({
  className = '',
  barClassName = 'h-[0.105em] w-[0.88em]',
}) => (
  <span className={`inline-flex items-baseline font-display font-black tracking-tight text-[#0f0f0f] ${className}`}>
    <span>Ek</span>
    <span className="relative inline-block leading-none">
      <span
        aria-hidden="true"
        className={`absolute left-1/2 -translate-x-1/2 top-[0.09em] bg-[#E53935] rounded-[1px] ${barClassName}`}
      />
      <span>a</span>
    </span>
  </span>
);
