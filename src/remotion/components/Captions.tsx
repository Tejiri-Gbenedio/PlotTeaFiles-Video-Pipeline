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

  // Show 2 words before + active + 2 words after (5 max) — matches channel style
  const phraseStart = Math.max(0, activeIndex - 2);
  const phraseEnd = Math.min(words.length, activeIndex + 3);
  const phrase = words.slice(phraseStart, phraseEnd);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: '0 56px 220px',
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 14px',
          justifyContent: 'center',
          maxWidth: 970,
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
                backgroundColor: active ? '#7C3AED' : 'transparent',
                borderRadius: 10,
                color: 'white',
                display: 'inline-block',
                fontFamily: 'Impact, Haettenschweiler, Arial Black, sans-serif',
                fontSize: 74,
                fontWeight: 900,
                letterSpacing: 2,
                lineHeight: 1.05,
                padding: active ? '4px 20px' : '4px 6px',
                textTransform: 'uppercase',
                WebkitTextStroke: active ? '0px transparent' : '4px black',
                textShadow: active ? 'none' : '0 6px 18px rgba(0,0,0,0.85)'
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
