/**
 * The Remotion composition: React components that draw one frame of the
 * video at a time. Remotion renders every frame in a headless browser and
 * joins them into an mp4.
 *
 * Screenshot and audio paths are loaded with staticFile(), which points at
 * the "public" folder that renderJob.ts fills with the job's files.
 */
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { settings } from "./settings";
import { buildTimeline, toFrames, type Aspect, type Scene, type VideoProps } from "./timeline";

/** The whole video: one scene per visible step, played back to back. */
export const JobVideo: React.FC<VideoProps> = ({ stepFile, aspect }) => {
  const { scenes } = buildTimeline(stepFile);
  return (
    <AbsoluteFill
      style={{ backgroundColor: settings.colors.background, fontFamily: settings.fontFamily }}
    >
      {scenes.map((scene) => (
        // Inside a Sequence, useCurrentFrame() starts again from 0, so each
        // scene can think in "frames since my own start".
        <Sequence key={scene.step.id} from={scene.from} durationInFrames={scene.frames}>
          <SceneView scene={scene} aspect={aspect} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

/** One step: the "before" screenshot, then a cut to the "after" screenshot. */
const SceneView: React.FC<{ scene: Scene; aspect: Aspect }> = ({ scene, aspect }) => {
  const frame = useCurrentFrame();
  const { step } = scene;
  const showAfter = frame >= toFrames(settings.timing.switchAt);

  return (
    <AbsoluteFill>
      {/*
        Both screenshots are always mounted and only their visibility changes.
        That way Remotion has both images loaded before the cut and there is
        no flash of empty background.
      */}
      <Screenshot file={step.screenshotBefore} visible={!showAfter} />
      <Screenshot file={step.screenshotAfter} visible={showAfter} />
      {step.audioFile ? <Audio src={staticFile(step.audioFile)} /> : null}
      {step.caption ? <Caption text={step.caption} aspect={aspect} /> : null}
    </AbsoluteFill>
  );
};

/** A screenshot scaled to fit the frame without cropping. */
const Screenshot: React.FC<{ file: string; visible: boolean }> = ({ file, visible }) => (
  <Img
    src={staticFile(file)}
    alt=""
    style={{
      position: "absolute",
      width: "100%",
      height: "100%",
      objectFit: "contain",
      opacity: visible ? 1 : 0,
    }}
  />
);

/** Subtitle near the bottom of the frame. */
const Caption: React.FC<{ text: string; aspect: Aspect }> = ({ text, aspect }) => {
  const { fontSize, bottom } = settings.caption[aspect];
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom,
        display: "flex",
        justifyContent: "center",
        padding: "0 40px",
      }}
    >
      <span
        style={{
          fontSize,
          fontWeight: 600,
          lineHeight: 1.25,
          textAlign: "center",
          color: settings.colors.captionText,
          backgroundColor: settings.colors.captionBackground,
          padding: "0.35em 0.8em",
          borderRadius: "0.4em",
        }}
      >
        {text}
      </span>
    </div>
  );
};
