import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {CaptionRenderWord} from '../types.js';

interface CaptionsProps {
  words: CaptionRenderWord[];
}

function getActiveWordIndex(words: CaptionRenderWord[], frame: number): number {
  const exactIndex = words.findIndex((word) => frame >= word.startFrame && frame <= word.endFrame);
  if (exactIndex !== -1) {
    return exactIndex;
  }

  return words.findIndex((word) => frame > word.endFrame && frame <= word.endFrame + 6);
}

export const Captions: React.FC<CaptionsProps> = ({words}) => {
  const frame = useCurrentFrame();
  const activeIndex = getActiveWordIndex(words, frame);

  if (activeIndex === -1) {
    return null;
  }

  const phraseStart = Math.max(0, activeIndex - 3);
  const phraseEnd = Math.min(words.length, activeIndex + 4);
  const phrase = words.slice(phraseStart, phraseEnd);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: '0 70px 250px',
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px 18px',
          justifyContent: 'center',
          maxWidth: 940,
          textAlign: 'center'
        }}
      >
        {phrase.map((word, offset) => {
          const index = phraseStart + offset;
          const active = index === activeIndex;

          return (
            <span
              key={`${word.text}-${word.startFrame}-${index}`}
              style={{
                color: active ? '#ffd84d' : 'white',
                display: 'inline-block',
                fontFamily: 'Impact, Haettenschweiler, Arial Black, sans-serif',
                fontSize: 68,
                fontWeight: 900,
                letterSpacing: 0,
                lineHeight: 0.95,
                textTransform: 'uppercase',
                transform: active ? 'scale(1.13)' : 'scale(1)',
                transformOrigin: 'center',
                WebkitTextStroke: '5px black',
                textShadow: '0 8px 20px rgba(0,0,0,0.75)'
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
