export type SegmentEffect = 'ken_burns' | 'camera_shake' | 'zoom_in' | 'static';

export type BRollKind = 'image' | 'video' | 'placeholder';

export interface CaptionRenderWord {
  text: string;
  start: number;
  end: number;
  startFrame: number;
  endFrame: number;
}

export interface BRollAsset {
  kind: BRollKind;
  keyword: string;
  src?: string;
  shots?: BRollShot[];
  source?: 'local' | 'pexels' | 'generated';
  credit?: string;
  creditUrl?: string;
  sourceUrl?: string;
  searchQuery?: string;
  refinedQueries?: string[];
  provider?: string;
  model?: string;
}

export interface BRollShot {
  src: string;
  provider?: string;
  model?: string;
  role?: string;
}

export interface SegmentRenderData {
  index: number;
  narration: string;
  brollKeyword: string;
  effect: SegmentEffect;
  startTime: number;
  endTime: number;
  startFrame: number;
  durationFrames: number;
  broll: BRollAsset;
}

export interface StoryRenderProps {
  [key: string]: unknown;
  id: string;
  title: string;
  hook: string;
  outro?: string;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  totalDurationSeconds: number;
  hookDurationFrames: number;
  audioSrc?: string;
  words: CaptionRenderWord[];
  segments: SegmentRenderData[];
}

export const DEFAULT_RENDER_PROPS: StoryRenderProps = {
  id: 'preview',
  title: 'PlotTeaFiles Preview',
  hook: 'A story starts with one impossible second.',
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 180,
  totalDurationSeconds: 6,
  hookDurationFrames: 75,
  words: [],
  segments: [
    {
      index: 0,
      narration: 'Preview segment',
      brollKeyword: 'preview',
      effect: 'ken_burns',
      startTime: 0,
      endTime: 6,
      startFrame: 0,
      durationFrames: 180,
      broll: {
        kind: 'placeholder',
        keyword: 'preview'
      }
    }
  ]
};
