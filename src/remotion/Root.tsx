import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {StoryComposition} from './StoryComposition.js';
import {DEFAULT_RENDER_PROPS} from './types.js';

const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="PlotPipeStory"
      component={StoryComposition}
      durationInFrames={DEFAULT_RENDER_PROPS.durationInFrames}
      fps={DEFAULT_RENDER_PROPS.fps}
      width={DEFAULT_RENDER_PROPS.width}
      height={DEFAULT_RENDER_PROPS.height}
      defaultProps={DEFAULT_RENDER_PROPS}
      calculateMetadata={({props}) => ({
        durationInFrames: Math.max(
          1,
          Math.ceil(props.durationInFrames ?? DEFAULT_RENDER_PROPS.durationInFrames)
        ),
        fps: props.fps ?? DEFAULT_RENDER_PROPS.fps,
        width: props.width ?? DEFAULT_RENDER_PROPS.width,
        height: props.height ?? DEFAULT_RENDER_PROPS.height
      })}
    />
  );
};

registerRoot(RemotionRoot);
