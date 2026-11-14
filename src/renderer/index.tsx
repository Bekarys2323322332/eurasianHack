/**
 * Entry point that Remotion bundles and opens in its headless browser.
 * It registers one composition called "JobVideo". Its size and length are
 * not fixed here: they are worked out from the props (the step file and the
 * chosen shape) in calculateMetadata.
 *
 * This file is only loaded by Remotion, never by the Next.js app.
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { settings } from "./settings";
import { buildTimeline, type VideoProps } from "./timeline";
import { JobVideo } from "./Video";

/** Placeholder props. renderJob.ts always passes the real ones. */
const emptyProps: VideoProps = {
  stepFile: {
    jobId: "empty",
    mode: "demo",
    url: "https://example.com",
    repoUrl: null,
    goal: "",
    language: "en",
    viewport: { width: 1280, height: 720 },
    title: "",
    steps: [],
  },
  aspect: "16:9",
  music: false,
};

const Root: React.FC = () => (
  <Composition
    id="JobVideo"
    component={JobVideo}
    fps={settings.fps}
    // These three are overwritten by calculateMetadata below.
    width={1920}
    height={1080}
    durationInFrames={1}
    defaultProps={emptyProps}
    calculateMetadata={({ props }) => ({
      ...settings.sizes[props.aspect],
      durationInFrames: buildTimeline(props.stepFile).totalFrames,
    })}
  />
);

registerRoot(Root);
