import React from 'react';
import {AbsoluteFill} from 'remotion';

export const Vignette: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        background:
          'radial-gradient(circle at center, rgba(0,0,0,0) 38%, rgba(0,0,0,0.28) 72%, rgba(0,0,0,0.64) 100%)'
      }}
    />
  );
};
