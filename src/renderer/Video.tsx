/**
 * The Remotion composition: React components that draw one frame of the
 * video at a time. Remotion renders every frame in a headless browser and
 * joins them into an mp4.
 *
 * Nothing here uses CSS animations or timers. Every moving thing is worked
 * out from the current frame number, which is what makes the render
 * repeatable frame by frame.
 *
 * Screenshot and audio paths are loaded with staticFile(), which points at
 * the "public" folder that renderJob.ts fills with the job's files.
 *
 * Layers, from back to front:
 *   gradient background
 *   stage (zooms as one piece): browser window with the screenshots,
 *     click ripple, cursor
 *   typing chip and caption (never zoom, so they stay readable)
 */
import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import type { StepFile } from "../shared/stepFile";
import { settings } from "./settings";
import {
  buildTimeline,
  musicVolume,
  toFrames,
  type Aspect,
  type Scene,
  type VideoProps,
} from "./timeline";

/** Stop values from running past the ends of an animation. */
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** Slow start, slow finish. Used for every camera and cursor move. */
const SMOOTH = { ...CLAMP, easing: Easing.inOut(Easing.cubic) };

/** "https://example.com/" becomes "example.com" for display. */
const prettyUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Where the browser window sits in the frame, and how to map page spots into it. */
interface Layout {
  frame: { width: number; height: number };
  window: { left: number; top: number; width: number; height: number };
  /** Size of the screenshot area inside the window. */
  content: { width: number; height: number };
  /** Turn a spot in viewport pixels into a spot in output pixels. */
  toFrame: (x: number, y: number) => { x: number; y: number };
}

function makeLayout(stepFile: StepFile, aspect: Aspect): Layout {
  const frame = settings.sizes[aspect];
  const { windowWidth, windowCenterY } = settings.layout[aspect];
  const { barHeight } = settings.window;
  // The screenshot is scaled so its width matches the window.
  const scale = windowWidth / stepFile.viewport.width;
  const content = { width: windowWidth, height: stepFile.viewport.height * scale };
  const height = content.height + barHeight;
  const left = (frame.width - windowWidth) / 2;
  const top = windowCenterY - height / 2;
  return {
    frame,
    window: { left, top, width: windowWidth, height },
    content,
    toFrame: (x, y) => ({ x: left + x * scale, y: top + barHeight + y * scale }),
  };
}

/** The whole video: title card, one scene per visible step, end card. */
export const JobVideo: React.FC<VideoProps> = ({ stepFile, aspect, music }) => {
  const frame = useCurrentFrame();
  const timeline = useMemo(() => buildTimeline(stepFile), [stepFile]);
  const layout = useMemo(() => makeLayout(stepFile, aspect), [stepFile, aspect]);
  const { titleFrames, scenes, endFrom, endFrames } = timeline;
  const fade = toFrames(settings.timing.softFadeSeconds);
  const address = prettyUrl(stepFile.url);

  // The steps as a whole fade in after the title card and out before the
  // end card, so the window does not pop in and out.
  const stepsOpacity =
    scenes.length > 0
      ? interpolate(
          frame,
          [titleFrames, titleFrames + fade, endFrom - fade, endFrom],
          [0, 1, 1, 0],
          CLAMP,
        )
      : 0;

  return (
    <AbsoluteFill
      style={{ background: settings.colors.backgroundGradient, fontFamily: settings.fontFamily }}
    >
      {music ? (
        <Audio
          src={staticFile(settings.music.file)}
          loop
          // Called for every frame: quieter while narration plays.
          volume={(musicFrame) => musicVolume(musicFrame, timeline)}
        />
      ) : null}

      <Sequence durationInFrames={titleFrames}>
        <Card
          // Only the name: the goal is written for the agent, not for viewers.
          title={stepFile.title || address}
          subtitle=""
          frames={titleFrames}
          aspect={aspect}
        />
      </Sequence>

      <AbsoluteFill style={{ opacity: stepsOpacity }}>
        {scenes.map((scene) => (
          // Inside a Sequence, useCurrentFrame() starts again from 0, so each
          // scene can think in "frames since my own start".
          <Sequence key={scene.step.id} from={scene.from} durationInFrames={scene.frames}>
            <SceneView scene={scene} layout={layout} aspect={aspect} address={address} />
          </Sequence>
        ))}
      </AbsoluteFill>

      <Sequence from={endFrom} durationInFrames={endFrames}>
        <Card
          title={stepFile.title}
          subtitle={address}
          strongSubtitle
          frames={endFrames}
          aspect={aspect}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

/** One step: cursor glide, zoom in, click, change of picture, zoom out. */
const SceneView: React.FC<{
  scene: Scene;
  layout: Layout;
  aspect: Aspect;
  address: string;
}> = ({ scene, layout, aspect, address }) => {
  const frame = useCurrentFrame();
  const { step, plan } = scene;
  const t = settings.timing;
  const { zoom, zoomPullToCenter } = settings.layout[aspect];

  // Cursor: travels from the previous step's spot to this step's spot.
  const glide = interpolate(
    frame,
    [toFrames(t.cursorGlideStart), toFrames(t.cursorGlideEnd)],
    [0, 1],
    SMOOTH,
  );
  const cursor = layout.toFrame(
    scene.startX + (scene.endX - scene.startX) * glide,
    scene.startY + (scene.endY - scene.startY) * glide,
  );

  // Camera: 0 means normal view, 1 means fully zoomed in on the click spot.
  // It moves in before the click, holds through the change of picture, and
  // eases back out.
  const zoomOutStart = plan.switchAt + plan.transitionFrames + toFrames(t.zoomHoldAfterSwitch);
  const zoomAmount = plan.zoom
    ? interpolate(
        frame,
        [
          toFrames(t.zoomInStart),
          toFrames(t.zoomInEnd),
          zoomOutStart,
          zoomOutStart + toFrames(t.zoomOutSeconds),
        ],
        [0, 1, 1, 0],
        SMOOTH,
      )
    : 0;

  // Scaling around the click spot keeps that spot fixed on screen. On top of
  // that the spot is nudged towards the middle so it is not stuck at an edge.
  const focus = layout.toFrame(scene.endX, scene.endY);
  const middle = { x: layout.frame.width / 2, y: settings.layout[aspect].windowCenterY };
  const shiftX = (middle.x - focus.x) * zoomPullToCenter * zoomAmount;
  const shiftY = (middle.y - focus.y) * zoomPullToCenter * zoomAmount;

  // Change of picture: 0 shows "before", 1 shows "after".
  const change =
    plan.transitionFrames === 0
      ? Number(frame >= plan.switchAt)
      : interpolate(frame, [plan.switchAt, plan.switchAt + plan.transitionFrames], [0, 1], SMOOTH);

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          transformOrigin: `${focus.x}px ${focus.y}px`,
          transform: `translate(${shiftX}px, ${shiftY}px) scale(${1 + (zoom - 1) * zoomAmount})`,
        }}
      >
        <BrowserWindow layout={layout} address={address}>
          {/*
            Both screenshots are always mounted. That way Remotion has both
            images loaded before the change and there is no empty flash.
          */}
          <Screenshot
            file={step.screenshotBefore}
            // A scroll pushes the old picture up and out of the window.
            shiftPercent={plan.transition === "slide" ? -100 * change : 0}
            opacity={1}
          />
          <Screenshot
            file={step.screenshotAfter}
            // A scroll brings the new picture up from below. Cuts and fades
            // lay it on top and change how see-through it is.
            shiftPercent={plan.transition === "slide" ? 100 * (1 - change) : 0}
            opacity={plan.transition === "slide" ? 1 : change}
          />
        </BrowserWindow>
        {plan.rippleAt !== null ? <Ripple at={plan.rippleAt} x={focus.x} y={focus.y} /> : null}
        <Cursor x={cursor.x} y={cursor.y} clickAt={plan.rippleAt} />
      </AbsoluteFill>

      {step.audioFile ? <Audio src={staticFile(step.audioFile)} /> : null}
      {plan.typing && step.typedText ? (
        <TypingChip text={step.typedText} typing={plan.typing} aspect={aspect} />
      ) : null}
      {step.caption ? <Caption text={step.caption} aspect={aspect} /> : null}
    </AbsoluteFill>
  );
};

/** Rounded window with a soft shadow, a small top bar and the page inside. */
const BrowserWindow: React.FC<{
  layout: Layout;
  address: string;
  children: React.ReactNode;
}> = ({ layout, address, children }) => {
  const { cornerRadius, barHeight, shadow } = settings.window;
  const { colors } = settings;
  return (
    <div
      style={{
        position: "absolute",
        ...layout.window,
        borderRadius: cornerRadius,
        boxShadow: shadow,
        overflow: "hidden",
        backgroundColor: "#ffffff",
      }}
    >
      <div
        style={{
          height: barHeight,
          backgroundColor: colors.windowBar,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 18px",
        }}
      >
        {colors.windowDots.map((color) => (
          <div
            key={color}
            style={{ width: 13, height: 13, borderRadius: "50%", backgroundColor: color }}
          />
        ))}
        <div
          style={{
            marginLeft: 14,
            padding: "3px 18px",
            borderRadius: 999,
            backgroundColor: "#ffffff",
            color: colors.windowBarText,
            fontSize: 18,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {address}
        </div>
      </div>
      {/* The page area. overflow hidden clips the pictures while they slide. */}
      <div style={{ position: "relative", overflow: "hidden", ...layout.content }}>{children}</div>
    </div>
  );
};

/** A screenshot filling the page area of the window. */
const Screenshot: React.FC<{ file: string; shiftPercent: number; opacity: number }> = ({
  file,
  shiftPercent,
  opacity,
}) => (
  <Img
    src={staticFile(file)}
    alt=""
    style={{
      position: "absolute",
      width: "100%",
      height: "100%",
      opacity,
      transform: `translateY(${shiftPercent}%)`,
    }}
  />
);

/** A ring that grows and fades at the click spot. */
const Ripple: React.FC<{ at: number; x: number; y: number }> = ({ at, x, y }) => {
  const frame = useCurrentFrame();
  const length = toFrames(settings.timing.rippleSeconds);
  if (frame < at || frame > at + length) return null;
  const progress = interpolate(frame, [at, at + length], [0, 1], {
    ...CLAMP,
    easing: Easing.out(Easing.cubic),
  });
  const size = settings.cursor.rippleSize * (0.25 + 0.75 * progress);
  return (
    <div
      style={{
        position: "absolute",
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: "50%",
        border: `5px solid ${settings.colors.accent}`,
        backgroundColor: "rgba(124, 108, 255, 0.22)",
        opacity: 1 - progress,
      }}
    />
  );
};

/** Our own arrow cursor. The tip of the arrow sits exactly on x, y. */
const Cursor: React.FC<{ x: number; y: number; clickAt: number | null }> = ({ x, y, clickAt }) => {
  const frame = useCurrentFrame();
  const { size } = settings.cursor;
  // A quick squeeze at the click moment makes the press feel physical.
  const press =
    clickAt === null
      ? 1
      : interpolate(frame, [clickAt - 3, clickAt, clickAt + 5], [1, 0.8, 1], CLAMP);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{
        position: "absolute",
        // In the drawing the tip is at (4, 2) out of 24, so shift by that much.
        left: x - (4 / 24) * size,
        top: y - (2 / 24) * size,
        transform: `scale(${press})`,
        transformOrigin: `${(4 / 24) * size}px ${(2 / 24) * size}px`,
        filter: "drop-shadow(0 3px 5px rgba(0, 0, 0, 0.4))",
      }}
    >
      <path
        d="M4 2 L4 19.5 L8.6 15.4 L11.6 22 L14.4 20.7 L11.5 14.3 L17.6 14 Z"
        fill="#111111"
        stroke="#ffffff"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
};

/** Shows the typed text appearing one letter at a time, with a caret. */
const TypingChip: React.FC<{
  text: string;
  typing: { start: number; end: number };
  aspect: Aspect;
}> = ({ text, typing, aspect }) => {
  const frame = useCurrentFrame();
  const fade = toFrames(settings.timing.softFadeSeconds);
  const { fontSize, bottom } = settings.typingChip[aspect];
  // Appear just before the first letter, leave shortly after the last one.
  const opacity = interpolate(
    frame,
    [typing.start - fade, typing.start, typing.end + fade, typing.end + 2 * fade],
    [0, 1, 1, 0],
    CLAMP,
  );
  if (opacity === 0) return null;
  const letters = Math.floor(interpolate(frame, [typing.start, typing.end], [0, text.length], CLAMP));
  return (
    <LowerThird bottom={bottom}>
      <span
        style={{
          fontSize,
          fontWeight: 600,
          opacity,
          color: settings.colors.typingText,
          backgroundColor: settings.colors.typingBackground,
          padding: "0.3em 0.7em",
          borderRadius: "0.45em",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
          // Keeps the chip from changing height before the first letter.
          minHeight: "1.25em",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {text.slice(0, letters)}
        <span
          style={{
            display: "inline-block",
            width: "0.08em",
            height: "1em",
            marginLeft: "0.08em",
            verticalAlign: "-0.12em",
            backgroundColor: settings.colors.accent,
          }}
        />
      </span>
    </LowerThird>
  );
};

/** Subtitle near the bottom of the frame. */
const Caption: React.FC<{ text: string; aspect: Aspect }> = ({ text, aspect }) => {
  const frame = useCurrentFrame();
  const { fontSize, bottom } = settings.caption[aspect];
  const opacity = interpolate(frame, [0, toFrames(settings.timing.softFadeSeconds)], [0, 1], CLAMP);
  return (
    <LowerThird bottom={bottom}>
      <span
        style={{
          fontSize,
          fontWeight: 600,
          lineHeight: 1.25,
          textAlign: "center",
          opacity,
          color: settings.colors.captionText,
          backgroundColor: settings.colors.captionBackground,
          padding: "0.35em 0.8em",
          borderRadius: "0.4em",
        }}
      >
        {text}
      </span>
    </LowerThird>
  );
};

/** Centres its content horizontally at a set distance from the bottom. */
const LowerThird: React.FC<{ bottom: number; children: React.ReactNode }> = ({
  bottom,
  children,
}) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom,
      display: "flex",
      justifyContent: "center",
      padding: "0 48px",
    }}
  >
    {children}
  </div>
);

/** Full-screen card with a big line and a smaller line. Used at both ends. */
const Card: React.FC<{
  title: string;
  subtitle: string;
  /** Make the smaller line bright and bold (used for the address). */
  strongSubtitle?: boolean;
  frames: number;
  aspect: Aspect;
}> = ({ title, subtitle, strongSubtitle, frames, aspect }) => {
  const frame = useCurrentFrame();
  const fade = toFrames(settings.timing.softFadeSeconds);
  const { titleSize, subtitleSize } = settings.cards[aspect];
  const opacity = interpolate(frame, [0, fade, frames - fade, frames], [0, 1, 1, 0], CLAMP);
  // The text rises a little as it appears.
  const rise = interpolate(frame, [0, fade * 2], [30, 0], {
    ...CLAMP,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        padding: "0 80px",
        opacity,
        transform: `translateY(${rise}px)`,
        overflowWrap: "anywhere",
      }}
    >
      {title ? (
        <div
          style={{
            fontSize: titleSize,
            fontWeight: 700,
            lineHeight: 1.1,
            color: settings.colors.cardTitle,
          }}
        >
          {title}
        </div>
      ) : null}
      {subtitle ? (
        <div
          style={{
            marginTop: titleSize * 0.35,
            fontSize: subtitleSize * (strongSubtitle ? 1.2 : 1),
            fontWeight: strongSubtitle ? 600 : 400,
            lineHeight: 1.3,
            color: strongSubtitle ? settings.colors.cardTitle : settings.colors.cardSubtitle,
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
