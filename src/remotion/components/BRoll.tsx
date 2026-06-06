import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame
} from 'remotion';
import {BRollShot, SegmentRenderData} from '../types.js';

interface BRollProps {
  segment: SegmentRenderData;
}

function hashKeyword(keyword: string): number {
  return keyword.split('').reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
}

function placeholderColors(keyword: string): [string, string, string] {
  const palettes: Array<[string, string, string]> = [
    ['#0e1116', '#3f6f8f', '#d7e9f2'],
    ['#141414', '#6d4a36', '#f4d8a8'],
    ['#111827', '#7b2f49', '#f2c6de'],
    ['#101820', '#335c67', '#fff3b0'],
    ['#161a1d', '#5c677d', '#edf2f4']
  ];

  return palettes[hashKeyword(keyword) % palettes.length];
}

function getTransform(
  segment: SegmentRenderData,
  frame: number,
  shotIndex = 0,
  shotDurationFrames = segment.durationFrames
): string {
  const progress = shotDurationFrames <= 1 ? 0 : frame / shotDurationFrames;
  const direction = shotIndex % 2 === 0 ? 1 : -1;

  if (segment.effect === 'static') {
    const scale = interpolate(progress, [0, 1], [1.03, 1.08]);
    return `scale(${scale})`;
  }

  if (segment.effect === 'camera_shake') {
    const x = Math.sin(frame * 1.7) * 8 + interpolate(progress, [0, 1], [-14, 14]) * direction;
    const y = Math.cos(frame * 1.3) * 6 + interpolate(progress, [0, 1], [10, -10]);
    return `scale(1.12) translate(${x}px, ${y}px)`;
  }

  if (segment.effect === 'zoom_in') {
    const scale = interpolate(progress, [0, 1], [1.04, 1.22]);
    const x = interpolate(progress, [0, 1], [12 * direction, -18 * direction]);
    return `scale(${scale}) translate(${x}px, 0)`;
  }

  const scale = interpolate(progress, [0, 1], [1.04, 1.18]);
  const x = interpolate(progress, [0, 1], [-28 * direction, 26 * direction]);
  const y = interpolate(progress, [0, 1], [18, -22]);
  return `scale(${scale}) translate(${x}px, ${y}px)`;
}

function getShotTiming(segment: SegmentRenderData, shotCount: number, frame: number): {
  index: number;
  frameInShot: number;
  shotDurationFrames: number;
} {
  const shotDurationFrames = Math.max(1, Math.ceil(segment.durationFrames / shotCount));
  const index = Math.min(shotCount - 1, Math.floor(frame / shotDurationFrames));

  return {
    index,
    frameInShot: frame - index * shotDurationFrames,
    shotDurationFrames
  };
}

function getShotOpacity(frameInShot: number, shotDurationFrames: number): number {
  const fadeFrames = Math.min(10, Math.floor(shotDurationFrames / 5));

  if (fadeFrames <= 0) {
    return 1;
  }

  const fadeIn = interpolate(frameInShot, [0, fadeFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });
  const fadeOut = interpolate(frameInShot, [shotDurationFrames - fadeFrames, shotDurationFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });

  return Math.min(fadeIn, fadeOut);
}

const CinematicOverlays: React.FC<{frame: number}> = ({frame}) => {
  const flicker = 0.035 + Math.sin(frame * 0.71) * 0.012;

  return (
    <>
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 16%, rgba(0,0,0,0) 80%, rgba(0,0,0,0.44) 100%)'
        }}
      />
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          backgroundImage:
            'radial-gradient(circle at 24% 28%, rgba(255,255,255,0.08) 0 1px, transparent 1px), radial-gradient(circle at 76% 66%, rgba(255,255,255,0.06) 0 1px, transparent 1px)',
          backgroundSize: '42px 42px, 58px 58px',
          mixBlendMode: 'screen',
          opacity: flicker
        }}
      />
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background: 'linear-gradient(90deg, rgba(12,24,34,0.18), rgba(80,58,36,0.12))',
          mixBlendMode: 'color'
        }}
      />
    </>
  );
};

const ImageShot: React.FC<{
  segment: SegmentRenderData;
  shot: BRollShot;
  shotIndex: number;
  frameInShot: number;
  shotDurationFrames: number;
}> = ({segment, shot, shotIndex, frameInShot, shotDurationFrames}) => {
  const transform = getTransform(segment, frameInShot, shotIndex, shotDurationFrames);
  const opacity = getShotOpacity(frameInShot, shotDurationFrames);

  return (
    <Img
      src={staticFile(shot.src)}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        opacity,
        transform,
        filter: 'contrast(1.1) saturate(1.02) brightness(0.92)',
        willChange: 'transform, opacity'
      }}
    />
  );
};

export const BRoll: React.FC<BRollProps> = ({segment}) => {
  const frame = useCurrentFrame();
  const transform = getTransform(segment, frame);
  const commonStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform,
    filter: 'contrast(1.05) saturate(1.05)',
    willChange: 'transform'
  };

  if (segment.broll.kind === 'image' && segment.broll.shots?.length) {
    const timing = getShotTiming(segment, segment.broll.shots.length, frame);
    const shot = segment.broll.shots[timing.index];

    return (
      <AbsoluteFill style={{backgroundColor: 'black', overflow: 'hidden'}}>
        <ImageShot
          segment={segment}
          shot={shot}
          shotIndex={timing.index}
          frameInShot={timing.frameInShot}
          shotDurationFrames={timing.shotDurationFrames}
        />
        <CinematicOverlays frame={frame} />
      </AbsoluteFill>
    );
  }

  if (segment.broll.kind === 'image' && segment.broll.src) {
    return (
      <AbsoluteFill style={{backgroundColor: 'black', overflow: 'hidden'}}>
        <Img src={staticFile(segment.broll.src)} style={commonStyle} />
        <CinematicOverlays frame={frame} />
      </AbsoluteFill>
    );
  }

  if (segment.broll.kind === 'video' && segment.broll.src) {
    return (
      <AbsoluteFill style={{backgroundColor: 'black', overflow: 'hidden'}}>
        <OffthreadVideo muted src={staticFile(segment.broll.src)} style={commonStyle} />
        <CinematicOverlays frame={frame} />
      </AbsoluteFill>
    );
  }

  const [base, accent, text] = placeholderColors(segment.broll.keyword);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: base,
        overflow: 'hidden'
      }}
    >
      <AbsoluteFill
        style={{
          transform,
          background: `linear-gradient(145deg, ${base} 0%, ${accent} 54%, #050505 100%)`
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          padding: 80
        }}
      >
        <div
          style={{
            color: text,
            fontFamily: 'Impact, Haettenschweiler, Arial Black, sans-serif',
            fontSize: 78,
            fontWeight: 900,
            letterSpacing: 0,
            lineHeight: 0.95,
            opacity: 0.62,
            textAlign: 'center',
            textTransform: 'uppercase',
            WebkitTextStroke: '3px rgba(0,0,0,0.72)'
          }}
        >
          {segment.broll.keyword}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
