/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface MascotProps {
  className?: string;
  mood?: 'happy' | 'studying' | 'celebrating' | 'warning';
  size?: number;
}

export const MascotOwl: React.FC<MascotProps> = ({
  className = '',
  mood = 'happy',
  size = 120,
}) => {
  return (
    <div
      className={`inline-block relative select-none ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 160 160"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-sm transition-transform duration-300 hover:scale-105"
      >
        {/* Soft shadow */}
        <ellipse cx="80" cy="148" rx="55" ry="10" fill="#e5e5e5" />

        {/* Feet */}
        <ellipse cx="62" cy="142" rx="12" ry="7" fill="#ff9600" />
        <ellipse cx="98" cy="142" rx="12" ry="7" fill="#ff9600" />

        {/* Body (Duolingo signature vibrant green) */}
        <rect
          x="28"
          y="38"
          width="104"
          height="106"
          rx="52"
          fill="#58cc02"
          stroke="#46a302"
          strokeWidth="4"
        />

        {/* Belly patch */}
        <ellipse cx="80" cy="106" rx="34" ry="32" fill="#78d824" />

        {/* Left Eye outer */}
        <circle cx="56" cy="74" r="22" fill="#ffffff" stroke="#46a302" strokeWidth="3" />
        {/* Right Eye outer */}
        <circle cx="104" cy="74" r="22" fill="#ffffff" stroke="#46a302" strokeWidth="3" />

        {/* Left Pupil */}
        <circle cx={mood === 'studying' ? '60' : '58'} cy="75" r="9" fill="#3c3c3c" />
        <circle cx={mood === 'studying' ? '62' : '61'} cy="72" r="3" fill="#ffffff" />

        {/* Right Pupil */}
        <circle cx={mood === 'studying' ? '108' : '102'} cy="75" r="9" fill="#3c3c3c" />
        <circle cx={mood === 'studying' ? '110' : '105'} cy="72" r="3" fill="#ffffff" />

        {/* Beak */}
        <polygon points="72,82 88,82 80,96" fill="#ff9600" stroke="#e08500" strokeWidth="2" strokeLinejoin="round" />

        {/* Glasses (if studying) */}
        {mood === 'studying' && (
          <g stroke="#2b70c9" strokeWidth="3.5" fill="none">
            <circle cx="56" cy="74" r="21" fill="rgba(28, 176, 246, 0.15)" />
            <circle cx="104" cy="74" r="21" fill="rgba(28, 176, 246, 0.15)" />
            <line x1="77" y1="74" x2="83" y2="74" />
          </g>
        )}

        {/* Cheeks */}
        <ellipse cx="40" cy="92" rx="7" ry="4" fill="#ff4b4b" opacity="0.4" />
        <ellipse cx="120" cy="92" rx="7" ry="4" fill="#ff4b4b" opacity="0.4" />

        {/* Wings */}
        <path
          d="M 28 85 Q 16 100 28 120"
          stroke="#46a302"
          strokeWidth="4"
          strokeLinecap="round"
          fill="#4eb800"
        />
        <path
          d="M 132 85 Q 144 100 132 120"
          stroke="#46a302"
          strokeWidth="4"
          strokeLinecap="round"
          fill="#4eb800"
        />

        {/* Book or Cap */}
        {mood === 'studying' ? (
          <g>
            {/* Open mini book */}
            <rect x="60" y="115" width="40" height="24" rx="3" fill="#1cb0f6" stroke="#1899d6" strokeWidth="2" />
            <rect x="63" y="117" width="16" height="20" rx="2" fill="#ffffff" />
            <rect x="81" y="117" width="16" height="20" rx="2" fill="#ffffff" />
            <line x1="66" y1="123" x2="76" y2="123" stroke="#e5e5e5" strokeWidth="2" />
            <line x1="66" y1="128" x2="74" y2="128" stroke="#e5e5e5" strokeWidth="2" />
            <line x1="84" y1="123" x2="94" y2="123" stroke="#e5e5e5" strokeWidth="2" />
            <line x1="84" y1="128" x2="92" y2="128" stroke="#e5e5e5" strokeWidth="2" />
          </g>
        ) : mood === 'celebrating' ? (
          <g>
            {/* Party hat */}
            <polygon points="68,36 92,36 80,10" fill="#ff9600" stroke="#e08500" strokeWidth="2" />
            <circle cx="80" cy="9" r="5" fill="#ffc800" />
          </g>
        ) : (
          <g>
            {/* Feather crest on head */}
            <path
              d="M 80 38 Q 78 22 84 20 Q 86 28 80 38 Z"
              fill="#46a302"
            />
          </g>
        )}
      </svg>
    </div>
  );
};
