import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

interface HookProps {
  text: string;
}

export const Hook: React.FC<HookProps> = ({text}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const opacity = interpolate(frame, [0, 10, Math.max(10, durationInFrames - 14), durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });
  const scale = interpolate(frame, [0, durationInFrames], [0.96, 1.04], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 86px',
        backgroundColor: 'rgba(0,0,0,0.2)',
        opacity
      }}
    >
      <h1
        style={{
          margin: 0,
          color: 'white',
          fontFamily: 'Impact, Haettenschweiler, Arial Black, sans-serif',
          fontSize: 96,
          fontWeight: 900,
          lineHeight: 1.02,
          letterSpacing: 0,
          textAlign: 'center',
          textTransform: 'uppercase',
          transform: `scale(${scale})`,
          WebkitTextStroke: '5px black',
          textShadow: '0 10px 30px rgba(0,0,0,0.7)'
        }}
      >
        {text}
      </h1>
    </AbsoluteFill>
  );
};
