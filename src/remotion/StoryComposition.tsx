import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {BRoll} from './components/BRoll.js';
import {Captions} from './components/Captions.js';
import {Hook} from './components/Hook.js';
import {Vignette} from './components/Vignette.js';
import {StoryRenderProps} from './types.js';

export const StoryComposition: React.FC<StoryRenderProps> = ({
  audioSrc,
  hook,
  hookDurationFrames,
  segments,
  words
}) => {
  return (
    <AbsoluteFill style={{backgroundColor: 'black'}}>
      {segments.map((segment) => (
        <Sequence
          key={segment.index}
          from={segment.startFrame}
          durationInFrames={segment.durationFrames}
        >
          <BRoll segment={segment} />
        </Sequence>
      ))}

      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
      <Vignette />
      <Captions words={words} />

      <Sequence from={0} durationInFrames={hookDurationFrames}>
        <Hook text={hook} />
      </Sequence>
    </AbsoluteFill>
  );
};
