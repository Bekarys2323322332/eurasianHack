/**
 * The Remotion composition: React components that draw one frame of the
 * video at a time. Remotion renders every frame in a headless browser and
 * joins them into an mp4.
 *
 * Nothing here uses CSS animations or timers. Every moving thing is worked
 * out from the current frame number, which is what makes the render
 * repeatable frame by frame.
 *
 * The three styles (trailer, tutorial, social) share this one file. Each
 * component looks at settings.look to decide which design to draw, so all
 * the differences between styles are switched from settings.ts.
 *
 * Screenshot and audio paths are loaded with staticFile(), which points at
 * the "public" folder that renderJob.ts fills with the job's files.
 *
 * Layers, from back to front:
 *   background colour, or a blurred copy of the page
 *   stage (zooms as one piece): the page (in a window or bare),
 *     click mark, cursor
 *   typing chip and caption (never zoom, so they stay readable)
 *   progress bar
 */
import React, { createContext, useContext, useMemo } from "react";
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
import { settingsFor, type Settings } from "./settings";
import {
  buildTimeline,
  musicVolume,
  recapLine,
  toFrames,
  type Aspect,
  type Scene,
  type VideoProps,
} from "./timeline";

/**
 * The settings of the chosen style. JobVideo provides them once and every
 * component below reads them with useSettings(), so no component needs to
 * know which style is active.
 */
const SettingsContext = createContext<Settings>(settingsFor("trailer"));
const useSettings = () => useContext(SettingsContext);

/** Stop values from running past the ends of an animation. */
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** Slow start, slow finish. Used for every camera and cursor move. */
const SMOOTH = { ...CLAMP, easing: Easing.inOut(Easing.cubic) };
/** Fast start, slow finish. Used for things that pop or slide in. */
const POP = { ...CLAMP, easing: Easing.out(Easing.cubic) };

/**
 * Seconds to frames for a fade, never less than one frame. Styles with hard
 * cuts set their fades close to zero, and a zero-length animation would be
 * an error.
 */
const fadeFrames = (seconds: number) => Math.max(1, toFrames(seconds));

/** Keep a number between two limits. */
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** How many lines a text needs when a line holds this many characters. */
function linesNeeded(words: string[], charsPerLine: number): number {
  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (used > 0 && used + 1 + word.length > charsPerLine) {
      lines += 1;
      used = word.length;
    } else {
      used += (used > 0 ? 1 : 0) + word.length;
    }
  }
  return lines;
}

/**
 * Shrink a text size until the text fits in the given width and number of
 * lines, and its longest word fits on one line. Real page titles and
 * captions can be far longer than the ones the sizes were tuned for.
 *
 * The browser is not asked to measure anything (that would not be reliable
 * frame by frame). Instead the width of a letter is estimated as a share of
 * the text size: about 0.62 for bold capitals, about 0.55 for normal text.
 * Stops at about a third of the starting size.
 */
function fitTextSize(
  text: string,
  size: number,
  maxWidth: number,
  maxLines: number,
  letterWidth: number,
): number {
  const words = text.split(/\s+/).filter(Boolean);
  const longest = Math.max(1, ...words.map((word) => word.length));
  let fitted = size;
  for (let attempt = 0; attempt < 13; attempt++) {
    const charsPerLine = Math.floor(maxWidth / (fitted * letterWidth));
    if (charsPerLine >= longest && linesNeeded(words, charsPerLine) <= maxLines) break;
    fitted *= 0.92;
  }
  return fitted;
}

/** CSS that cuts text off with "..." after a number of lines. */
const clampLines = (lines: number): React.CSSProperties => ({
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: lines,
  overflow: "hidden",
});

/** Letters and digits only, in lower case, for comparing words and titles. */
const bare = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

/** "https://example.com/" becomes "example.com" for display. */
const prettyUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Where the page sits in the frame, and how to map page spots into it. */
interface Layout {
  frame: { width: number; height: number };
  window: { left: number; top: number; width: number; height: number };
  /** Size of the screenshot area inside the window. */
  content: { width: number; height: number };
  /** Turn a spot in viewport pixels into a spot in output pixels. */
  toFrame: (x: number, y: number) => { x: number; y: number };
}

function makeLayout(stepFile: StepFile, aspect: Aspect, settings: Settings): Layout {
  const frame = settings.sizes[aspect];
  const { windowWidth, windowCenterY } = settings.layout[aspect];
  // Without window chrome there is no top bar above the page.
  const barHeight = settings.look.windowChrome ? settings.window.barHeight : 0;
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
export const JobVideo: React.FC<VideoProps> = ({ stepFile, aspect, style, music, sfx = false }) => {
  const settings = settingsFor(style);
  const timeline = useMemo(() => buildTimeline(stepFile, settings), [stepFile, settings]);
  const layout = useMemo(
    () => makeLayout(stepFile, aspect, settings),
    [stepFile, aspect, settings],
  );
  const { howto, titleFrames, scenes, endFrom, endFrames, totalFrames } = timeline;
  const address = prettyUrl(stepFile.url);
  // "How to create a project": the goal with its first letter in lower case.
  const howToTitle = stepFile.goal
    ? `${settings.words.howTo} ${stepFile.goal[0].toLowerCase()}${stepFile.goal.slice(1)}`
    : stepFile.title;

  return (
    <SettingsContext.Provider value={settings}>
      <AbsoluteFill
        style={{ background: settings.colors.background, fontFamily: settings.fontFamily }}
      >
        {music ? (
          <Audio
            src={staticFile(settings.music.file)}
            loop
            // Called for every frame: quieter while narration plays.
            volume={(musicFrame) => musicVolume(musicFrame, timeline, settings)}
          />
        ) : null}

        {/* Styles with a title card length of 0 open straight on the first step. */}
        {titleFrames > 0 ? (
          <Sequence durationInFrames={titleFrames}>
            {sfx ? (
              <>
                <Audio src={staticFile("sfx/hit.wav")} volume={SFX.hit} />
                <Sequence from={Math.max(0, titleFrames - 40)} durationInFrames={40}>
                  <Audio src={staticFile("sfx/rise.wav")} volume={SFX.rise} />
                </Sequence>
              </>
            ) : null}
            {howto ? (
              // How-to videos open with what the viewer will learn.
              <Card
                title={howToTitle}
                // The planner often names the video after the goal. Showing
                // the same words twice looks like a mistake, so skip it then.
                subtitle={bare(howToTitle).includes(bare(stepFile.title)) ? "" : stepFile.title}
                frames={titleFrames}
                aspect={aspect}
              />
            ) : (
              <Card
                // Only the name: in demo mode the goal is written for the
                // agent, not for viewers.
                title={stepFile.title || address}
                subtitle=""
                frames={titleFrames}
                aspect={aspect}
              />
            )}
          </Sequence>
        ) : null}

        {scenes.map((scene) => (
          // Inside a Sequence, useCurrentFrame() starts again from 0, so each
          // scene can think in "frames since my own start".
          <Sequence key={scene.step.id} from={scene.from} durationInFrames={scene.frames}>
            <SceneView scene={scene} layout={layout} aspect={aspect} address={address} sfx={sfx} />
            {howto ? <Badge number={scene.number} total={scenes.length} aspect={aspect} /> : null}
          </Sequence>
        ))}

        <Sequence from={endFrom} durationInFrames={endFrames}>
          {sfx ? <Audio src={staticFile("sfx/chime.wav")} volume={SFX.chime} /> : null}
          {howto ? (
            <RecapCard
              heading={howToTitle}
              lines={scenes.map((scene) => recapLine(scene.step))}
              address={address}
              frames={endFrames}
              aspect={aspect}
            />
          ) : (
            <Card
              title={stepFile.title}
              subtitle={address}
              strongSubtitle
              frames={endFrames}
              aspect={aspect}
            />
          )}
        </Sequence>

        {settings.look.progressBar ? <ProgressBar totalFrames={totalFrames} /> : null}
      </AbsoluteFill>
    </SettingsContext.Provider>
  );
};

/** One step: cursor glide, zoom in, click, change of picture, zoom out. */
/** Sound effect volumes, kept under the narration. */
const SFX = { click: 0.85, whoosh: 0.75, key: 0.6, pop: 0.6, chime: 0.9, hit: 0.9, rise: 0.6, keyEveryFrames: 3, maxKeys: 10 };

/** Film grain and a dark band top and bottom, like a trailer. */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.6 0'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>\")";
const CinemaLook: React.FC<{ strength?: number }> = ({ strength = 1 }) => (
  <>
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        backgroundImage: GRAIN,
        backgroundSize: "240px 240px",
        opacity: 0.07 * strength,
        mixBlendMode: "overlay",
      }}
    />
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background: `linear-gradient(to bottom, rgba(0,0,0,${0.35 * strength}) 0%, rgba(0,0,0,0) 14%, rgba(0,0,0,0) 86%, rgba(0,0,0,${0.35 * strength}) 100%)`,
      }}
    />
  </>
);

/** Short sounds that line up with what the viewer sees: a whoosh as the scene arrives, a click, key ticks. */
const SceneSounds: React.FC<{ scene: Scene; hasCaption: boolean }> = ({ scene, hasCaption }) => {
  const { plan } = scene;
  const popAt = Math.min(4, Math.max(0, scene.frames - 2));
  const keys: number[] = [];
  if (plan.typing) {
    for (let at = plan.typing.start; at < plan.typing.end && keys.length < SFX.maxKeys; at += SFX.keyEveryFrames) {
      keys.push(at);
    }
  }
  return (
    <>
      {scene.from > 0 ? (
        <Sequence from={0} durationInFrames={Math.min(scene.frames, 20)}>
          <Audio src={staticFile("sfx/whoosh.wav")} volume={SFX.whoosh} />
        </Sequence>
      ) : null}
      {hasCaption && scene.frames > 6 ? (
        <Sequence from={popAt} durationInFrames={Math.min(scene.frames - popAt, 8)}>
          <Audio src={staticFile("sfx/pop.wav")} volume={SFX.pop} />
        </Sequence>
      ) : null}
      {plan.rippleAt !== null && plan.rippleAt < scene.frames - 1 ? (
        <Sequence from={plan.rippleAt} durationInFrames={Math.min(scene.frames - plan.rippleAt, 6)}>
          <Audio src={staticFile("sfx/click.wav")} volume={SFX.click} />
        </Sequence>
      ) : null}
      {keys.map((at) =>
        at < scene.frames - 1 ? (
          <Sequence key={at} from={at} durationInFrames={Math.min(scene.frames - at, 3)}>
            <Audio src={staticFile("sfx/key.wav")} volume={SFX.key} />
          </Sequence>
        ) : null,
      )}
    </>
  );
};

/** A soft dark edge that draws the eye to the middle of the picture. */
const Vignette: React.FC<{ strength: number }> = ({ strength }) => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${0.45 * strength}) 100%)`,
    }}
  />
);

const SceneView: React.FC<{
  scene: Scene;
  layout: Layout;
  aspect: Aspect;
  address: string;
  sfx: boolean;
}> = ({ scene, layout, aspect, address, sfx }) => {
  const frame = useCurrentFrame();
  const settings = useSettings();
  const { step, plan } = scene;
  const t = settings.timing;
  const { look } = settings;
  const { zoom, restZoom, zoomPullToCenter } = settings.layout[aspect];

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

  // The camera always looks at the cursor. Between actions the page is shown
  // at restZoom (1 in the wide shape, larger in the tall shape so real pages
  // stay readable), and it moves in to "zoom" around a click.
  const focus = layout.toFrame(scene.endX, scene.endY);
  const scale = restZoom + (zoom - restZoom) * zoomAmount;
  // 0 at natural size, 1 when fully zoomed in.
  const closeness = zoom > 1 ? (scale - 1) / (zoom - 1) : 0;

  // Scaling around the cursor keeps it fixed on screen. The closer the
  // camera, the further the cursor is nudged towards the middle of the frame
  // so it is not stuck at an edge.
  const middle = { x: layout.frame.width / 2, y: settings.layout[aspect].windowCenterY };
  let landX = cursor.x + (middle.x - cursor.x) * zoomPullToCenter * closeness;
  let landY = cursor.y + (middle.y - cursor.y) * zoomPullToCenter * closeness;

  // Never leave the spot being clicked underneath the caption: when it sits
  // low on the page, lift it clear as the camera moves in.
  const captionSize = settings.caption[aspect];
  const captionTop =
    layout.frame.height - captionSize.bottom - captionSize.fontSize * 2.6;
  if (cursor.y > captionTop) {
    landY = Math.min(landY, cursor.y + (captionTop - cursor.y) * closeness);
  }

  // When the enlarged page is wider than the frame, do not slide it so far
  // that empty background shows beside it.
  const edge = layout.window.left;
  const mostRight = edge + (cursor.x - layout.window.left) * scale;
  const mostLeft =
    layout.frame.width - edge - (layout.window.left + layout.window.width - cursor.x) * scale;
  if (mostLeft <= mostRight) landX = clamp(landX, mostLeft, mostRight);

  // Scroll steps: how far the page moved, as a share of its height. Unknown
  // means a full screen, which looks like one page pushing the other away.
  const scrollShift = step.scrollShift ?? 1;

  // Change of picture: 0 shows "before", 1 shows "after".
  const change =
    plan.transitionFrames === 0
      ? Number(frame >= plan.switchAt)
      : interpolate(frame, [plan.switchAt, plan.switchAt + plan.transitionFrames], [0, 1], SMOOTH);

  // Hand-over between scenes. "arrive" runs 0 to 1 at the start of the
  // scene and "leave" runs 0 to 1 at its end. A glide moves the stage
  // sideways as well as fading it; a fade only fades; a cut does neither.
  const handOver = fadeFrames(look.sceneTransitionSeconds);
  const arrive =
    look.sceneTransition === "cut" ? 1 : interpolate(frame, [0, handOver], [0, 1], POP);
  const leave =
    look.sceneTransition === "cut"
      ? 0
      : interpolate(frame, [scene.frames - handOver, scene.frames], [0, 1], {
          ...CLAMP,
          easing: Easing.in(Easing.cubic),
        });
  const slide =
    look.sceneTransition === "glide" ? (1 - arrive - leave) * layout.frame.width * 0.45 : 0;

  return (
    <AbsoluteFill>
      {look.backdrop === "blurredPage" ? (
        <BlurredBackdrop
          file={change < 0.5 ? step.screenshotBefore : step.screenshotAfter}
          frame={layout.frame}
        />
      ) : null}

      <AbsoluteFill
        style={{ opacity: Math.min(arrive, 1 - leave), transform: `translateX(${slide}px)` }}
      >
        <AbsoluteFill
          style={{
            transformOrigin: `${cursor.x}px ${cursor.y}px`,
            transform: `translate(${landX - cursor.x}px, ${landY - cursor.y}px) scale(${scale})`,
          }}
        >
          <PageFrame layout={layout} address={address}>
            {/*
              Both screenshots are always mounted. That way Remotion has both
              images loaded before the change and there is no empty flash.
            */}
            {plan.transition === "slide" ? (
              <>
                {/*
                  A scroll is a vertical pan. The "after" picture sits below
                  the "before" picture by exactly the distance the page
                  moved, and both travel up together, so the part they share
                  lines up and the page appears to scroll. "Before" stays on
                  top while moving (so a header that sticks to the top of the
                  page does not appear twice) and fades away at the end.
                */}
                <Screenshot
                  file={step.screenshotAfter}
                  shiftPercent={100 * scrollShift * (1 - change)}
                  opacity={1}
                />
                <Screenshot
                  file={step.screenshotBefore}
                  shiftPercent={-100 * scrollShift * change}
                  opacity={interpolate(change, [0.8, 1], [1, 0], CLAMP)}
                />
              </>
            ) : (
              <>
                {/* Cuts and fades lay "after" on top and make it less see-through. */}
                <Screenshot file={step.screenshotBefore} shiftPercent={0} opacity={1} />
                <Screenshot file={step.screenshotAfter} shiftPercent={0} opacity={change} />
              </>
            )}
          </PageFrame>
          {plan.rippleAt !== null ? <ClickMark at={plan.rippleAt} x={focus.x} y={focus.y} /> : null}
          <Cursor x={cursor.x} y={cursor.y} clickAt={plan.rippleAt} />
        </AbsoluteFill>
      </AbsoluteFill>

      <Vignette strength={0.6 + 0.4 * closeness} />
      <CinemaLook strength={0.8} />
      {sfx ? <SceneSounds scene={scene} hasCaption={Boolean(step.caption)} /> : null}
      {step.audioFile ? <Audio src={staticFile(step.audioFile)} /> : null}
      {plan.typing && step.typedText ? (
        <TypingChip text={step.typedText} typing={plan.typing} aspect={aspect} />
      ) : null}
      {step.caption ? (
        <Caption
          text={step.caption}
          keyWord={step.keyWord ?? null}
          aspect={aspect}
          sceneFrames={scene.frames}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * A blurred, darkened copy of the page that fills the whole frame. Used by
 * styles that have no window, so the picture reaches every edge even when
 * the page is a different shape from the video.
 */
const BlurredBackdrop: React.FC<{ file: string; frame: { width: number; height: number } }> = ({
  file,
  frame,
}) => (
  // Blurring a full-size picture on every frame is slow. A blurred picture
  // has no fine detail anyway, so it is drawn at one eighth of the size with
  // a small blur and then stretched to fill the frame. It looks the same and
  // renders several times faster.
  <div
    style={{
      position: "absolute",
      left: 0,
      top: 0,
      width: frame.width / 8,
      height: frame.height / 8,
      overflow: "hidden",
      transform: "scale(8)",
      transformOrigin: "0 0",
    }}
  >
    <Img
      src={staticFile(file)}
      alt=""
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        // Scaled up a little so the soft blurred edge is outside the frame.
        transform: "scale(1.25)",
        filter: "blur(4.5px) brightness(0.42) saturate(1.3)",
      }}
    />
  </div>
);

/**
 * Holds the page. With window chrome: a rounded window with a soft shadow
 * and a small top bar. Without: the bare page, edge to edge.
 */
const PageFrame: React.FC<{
  layout: Layout;
  address: string;
  children: React.ReactNode;
}> = ({ layout, address, children }) => {
  const settings = useSettings();
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
      {settings.look.windowChrome ? (
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
      ) : null}
      {/* The page area. overflow hidden clips the pictures while they slide. */}
      <div style={{ position: "relative", overflow: "hidden", ...layout.content }}>{children}</div>
    </div>
  );
};

/** A screenshot filling the page area. */
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

/**
 * Marks the click spot.
 * "ripple": a ring that bursts outwards at the click and is gone.
 * "ring": a steady ring that appears when the cursor arrives, gives a small
 * squeeze at the click, and stays for a moment so the viewer can see
 * exactly what was pressed.
 */
const ClickMark: React.FC<{ at: number; x: number; y: number }> = ({ at, x, y }) => {
  const frame = useCurrentFrame();
  const settings = useSettings();
  const { accent } = settings.colors;
  const { markSize } = settings.cursor;

  let size: number;
  let opacity: number;
  if (settings.look.clickMark === "ring") {
    const from = toFrames(settings.timing.cursorGlideEnd);
    const until = at + toFrames(settings.timing.ringHoldSeconds);
    const fade = 6;
    opacity = interpolate(frame, [from - fade, from, until, until + fade], [0, 1, 1, 0], CLAMP);
    size = markSize * interpolate(frame, [at - 3, at, at + 6], [1, 0.82, 1], CLAMP);
  } else {
    const length = toFrames(settings.timing.rippleSeconds);
    if (frame < at) return null;
    const progress = interpolate(frame, [at, at + length], [0, 1], POP);
    size = markSize * (0.25 + 0.75 * progress);
    opacity = 1 - progress;
  }
  if (opacity <= 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: "50%",
        border: `5px solid ${accent}`,
        // "33" on the end of a hex colour makes it about 20 percent solid.
        backgroundColor: `${accent}33`,
        boxShadow: `0 0 24px ${accent}66`,
        opacity,
      }}
    />
  );
};

/**
 * Our own cursor. "arrow": a mouse pointer whose tip sits exactly on x, y.
 * "dot": a round touch marker centred on x, y.
 */
const Cursor: React.FC<{ x: number; y: number; clickAt: number | null }> = ({ x, y, clickAt }) => {
  const frame = useCurrentFrame();
  const settings = useSettings();
  const { size } = settings.cursor;
  const { cursorFill, cursorEdge } = settings.colors;
  // A quick squeeze at the click moment makes the press feel physical.
  const press =
    clickAt === null
      ? 1
      : interpolate(frame, [clickAt - 3, clickAt, clickAt + 5], [1, 0.8, 1], CLAMP);

  if (settings.look.cursorDesign === "dot") {
    return (
      <div
        style={{
          position: "absolute",
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          borderRadius: "50%",
          backgroundColor: cursorFill,
          border: `4px solid ${cursorEdge}`,
          boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)",
          transform: `scale(${press})`,
        }}
      />
    );
  }

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
        fill={cursorFill}
        stroke={cursorEdge}
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
  const settings = useSettings();
  const fade = fadeFrames(settings.timing.softFadeSeconds);
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
            backgroundColor: settings.colors.typingText,
          }}
        />
      </span>
    </LowerThird>
  );
};

interface CaptionProps {
  text: string;
  /** The word to highlight, when the step file names one. */
  keyWord: string | null;
  aspect: Aspect;
  sceneFrames: number;
}

/** Picks the caption design of the active style. */
const Caption: React.FC<CaptionProps> = (props) => {
  const settings = useSettings();
  const { captionDesign } = settings.look;
  if (captionDesign === "bar") return <BarCaption {...props} />;
  // The two large designs have no box behind the text. While the camera is
  // zoomed in, a bright page can slide underneath them, so the bottom of the
  // frame fades to dark to keep light text readable on any page.
  const { fontSize, bottom } = settings.caption[props.aspect];
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          // Tall enough for two lines of caption plus a soft run-in above.
          height: bottom + fontSize * 3.6,
          background: "linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.78) 55%)",
        }}
      />
      {captionDesign === "words" ? <WordsCaption {...props} /> : <HighlightCaption {...props} />}
    </>
  );
};

/**
 * Trailer caption: big bold text with no box behind it. The words pop in
 * one after another, spread over the first part of the scene.
 */
const WordsCaption: React.FC<CaptionProps> = ({ text, aspect, sceneFrames }) => {
  const frame = useCurrentFrame();
  const settings = useSettings();
  const { bottom, maxLines } = settings.caption[aspect];
  const fontSize = fitTextSize(
    text,
    settings.caption[aspect].fontSize,
    settings.sizes[aspect].width - 96,
    maxLines,
    0.62,
  );
  const words = text.split(/\s+/).filter(Boolean);
  // Frames between one word and the next: slower for short captions in long
  // scenes, but always between 2 and 7 so it never drags or blurs together.
  const gap = Math.min(7, Math.max(2, Math.floor((sceneFrames * 0.4) / words.length)));
  return (
    <LowerThird bottom={bottom}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0 0.28em",
          fontSize,
          fontWeight: 800,
          lineHeight: 1.1,
          letterSpacing: "-0.01em",
          textTransform: settings.look.captionUppercase ? "uppercase" : "none",
          color: settings.colors.captionText,
          textShadow: "0 6px 28px rgba(0, 0, 0, 0.75), 0 2px 4px rgba(0, 0, 0, 0.6)",
        }}
      >
        {words.map((word, position) => {
          const pop = interpolate(frame, [position * gap, position * gap + 5], [0, 1], POP);
          return (
            // The position is part of the key because a word can repeat.
            <span
              key={`${position}-${word}`}
              style={{
                display: "inline-block",
                opacity: pop,
                transform: `translateY(${(1 - pop) * 28}px) scale(${0.8 + 0.2 * pop})`,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </LowerThird>
  );
};

/**
 * Tutorial caption: small text in a clean bar across the bottom of the
 * frame. The bar itself never moves; only the text fades in.
 * The "bottom" setting is extra space under the text inside the bar.
 */
const BarCaption: React.FC<CaptionProps> = ({ text, aspect }) => {
  const frame = useCurrentFrame();
  const settings = useSettings();
  const { bottom, maxLines } = settings.caption[aspect];
  const fontSize = fitTextSize(
    text,
    settings.caption[aspect].fontSize,
    settings.sizes[aspect].width - 120,
    maxLines,
    0.55,
  );
  const opacity = interpolate(frame, [0, fadeFrames(settings.timing.softFadeSeconds)], [0, 1], CLAMP);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: `${fontSize * 0.75}px 60px ${fontSize * 0.75 + bottom}px`,
        backgroundColor: settings.colors.captionBackground,
        borderTop: `4px solid ${settings.colors.accent}`,
        boxShadow: "0 -8px 30px rgba(40, 60, 100, 0.12)",
        textAlign: "center",
        fontSize,
        fontWeight: 500,
        lineHeight: 1.3,
        textTransform: settings.look.captionUppercase ? "uppercase" : "none",
        color: settings.colors.captionText,
      }}
    >
      <span style={{ opacity }}>{text}</span>
    </div>
  );
};

/**
 * Social caption: very large centred text. The key word gets a block of the
 * accent colour behind it. The whole caption snaps in with a tiny pop.
 */
const HighlightCaption: React.FC<CaptionProps> = ({ text, keyWord, aspect }) => {
  const frame = useCurrentFrame();
  const settings = useSettings();
  const { bottom, maxLines } = settings.caption[aspect];
  const fontSize = fitTextSize(
    text,
    settings.caption[aspect].fontSize,
    // Narrower than the frame: the highlight block adds padding of its own.
    settings.sizes[aspect].width - 140,
    maxLines,
    0.62,
  );
  const words = text.split(/\s+/).filter(Boolean);
  // Which word gets the highlight (-1 for none). The step file can name it
  // in "keyWord". Otherwise fall back to the longest word, but never one of
  // three letters or fewer ("the", "you", "in" are never the point).
  // ponytail: longest word is a guess; the script stage should set keyWord.
  let key = keyWord ? words.findIndex((word) => bare(word) === bare(keyWord)) : -1;
  if (key === -1) {
    words.forEach((word, position) => {
      const length = bare(word).length;
      if (length > 3 && (key === -1 || length > bare(words[key]).length)) key = position;
    });
  }
  const pop = interpolate(frame, [0, 3], [0.9, 1], POP);
  return (
    <LowerThird bottom={bottom}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0.12em 0.26em",
          fontSize,
          fontWeight: 900,
          lineHeight: 1.05,
          textTransform: settings.look.captionUppercase ? "uppercase" : "none",
          color: settings.colors.captionText,
          textShadow: "0 6px 26px rgba(0, 0, 0, 0.8), 0 2px 4px rgba(0, 0, 0, 0.7)",
          transform: `scale(${pop})`,
        }}
      >
        {words.map((word, position) => (
          <span
            key={`${position}-${word}`}
            style={
              position === key
                ? {
                    display: "inline-block",
                    padding: "0.02em 0.18em",
                    borderRadius: "0.1em",
                    backgroundColor: settings.colors.accent,
                    color: settings.colors.onAccent,
                    textShadow: "none",
                    transform: "rotate(-2deg)",
                  }
                : { display: "inline-block" }
            }
          >
            {word}
          </span>
        ))}
      </div>
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

/** A thin bar across the top that fills from left to right as the video plays. */
const ProgressBar: React.FC<{ totalFrames: number }> = ({ totalFrames }) => {
  const frame = useCurrentFrame();
  const settings = useSettings();
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        height: 14,
        backgroundColor: "rgba(255, 255, 255, 0.22)",
      }}
    >
      <div
        style={{
          width: `${(100 * (frame + 1)) / totalFrames}%`,
          height: "100%",
          backgroundColor: settings.colors.accent,
        }}
      />
    </div>
  );
};

/**
 * Full-screen card with a big line and a smaller line. Used at both ends.
 * "bold" design: huge capital letters that land with a slight zoom, over a
 * thick accent stroke. "simple" design: a modest title under a short accent
 * line, with a plain fade.
 */
const Card: React.FC<{
  title: string;
  subtitle: string;
  /** Make the smaller line bright and bold (used for the address). */
  strongSubtitle?: boolean;
  frames: number;
  aspect: Aspect;
}> = ({ title, subtitle, strongSubtitle, frames, aspect }) => {
  const frame = useCurrentFrame();
  const settings = useSettings();
  const bold = settings.look.cardDesign === "bold";
  const fade = fadeFrames(settings.timing.softFadeSeconds);
  const { subtitleSize } = settings.cards[aspect];
  // Long titles (real page titles can be a whole sentence) are drawn smaller
  // so they fit in a few lines, and cut off with "..." past that.
  const titleSize = fitTextSize(
    title,
    settings.cards[aspect].titleSize,
    settings.sizes[aspect].width - 160,
    settings.cardTitleMaxLines,
    bold ? 0.62 : 0.55,
  );
  const opacity = interpolate(frame, [0, fade, frames - fade, frames], [0, 1, 1, 0], CLAMP);
  const arrive = interpolate(frame, [0, 10], [0, 1], POP);
  // A slow push-in over the whole card, like a film title.
  const pushIn = 1 + 0.06 * interpolate(frame, [0, Math.max(1, frames)], [0, 1], CLAMP);
  // Bold cards land from slightly too big. Simple cards rise a little.
  const transform = bold
    ? `scale(${(1.18 - 0.18 * arrive) * pushIn})`
    : `translateY(${(1 - arrive) * 24}px) scale(${pushIn})`;
  const accentLine = (
    <div
      style={{
        // The stroke of a bold card grows out from the left as it lands.
        width: bold ? titleSize * 1.6 * arrive : titleSize,
        height: bold ? titleSize * 0.09 : 6,
        borderRadius: 999,
        backgroundColor: settings.colors.accent,
        margin: bold ? `${titleSize * 0.16}px 0 0` : `0 0 ${titleSize * 0.4}px`,
      }}
    />
  );
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        padding: "0 80px",
        opacity,
        transform,
        overflowWrap: "anywhere",
      }}
    >
      {bold ? null : accentLine}
      {title ? (
        <div
          style={{
            fontSize: titleSize,
            fontWeight: bold ? 900 : 600,
            lineHeight: 1.05,
            letterSpacing: bold ? "-0.03em" : "0",
            textTransform: bold ? "uppercase" : "none",
            color: settings.colors.cardTitle,
            ...clampLines(settings.cardTitleMaxLines),
          }}
        >
          {title}
        </div>
      ) : null}
      {bold ? accentLine : null}
      {subtitle ? (
        <div
          style={{
            marginTop: titleSize * 0.3,
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

/** How-to videos: a small "1 of 6" label so viewers know where they are. */
const Badge: React.FC<{ number: number; total: number; aspect: Aspect }> = ({
  number,
  total,
  aspect,
}) => {
  const settings = useSettings();
  const { fontSize, left, top } = settings.badge[aspect];
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        fontSize,
        fontWeight: 700,
        color: settings.colors.onAccent,
        backgroundColor: settings.colors.accent,
        padding: "0.3em 0.8em",
        borderRadius: 999,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
      }}
    >
      {number} {settings.words.of} {total}
    </div>
  );
};

/** How-to videos: end card with the steps written out as a numbered list. */
const RecapCard: React.FC<{
  heading: string;
  lines: string[];
  address: string;
  frames: number;
  aspect: Aspect;
}> = ({ heading, lines, address, frames, aspect }) => {
  const frame = useCurrentFrame();
  const settings = useSettings();
  const fade = fadeFrames(settings.timing.softFadeSeconds);
  const { width, height } = settings.sizes[aspect];
  const headingSize = fitTextSize(heading, settings.recap[aspect].headingSize, width - 180, 2, 0.6);
  const opacity = interpolate(frame, [0, fade, frames - fade, frames], [0, 1, 1, 0], CLAMP);
  // Shrink the list text when there are many steps, so the whole list fits
  // in about 60 percent of the frame height (each line takes about 1.7 times
  // its text size).
  const lineSize = Math.min(
    settings.recap[aspect].lineSize,
    (height * 0.6) / (Math.max(lines.length, 1) * 1.7),
  );
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "0 90px",
        opacity,
        color: settings.colors.cardTitle,
        overflowWrap: "anywhere",
      }}
    >
      <div style={{ maxWidth: "100%" }}>
        <div style={{ fontSize: headingSize, fontWeight: 700, lineHeight: 1.15 }}>{heading}</div>
        <ol style={{ listStyle: "none", padding: 0, margin: `${headingSize * 0.6}px 0` }}>
          {lines.map((line, position) => (
            // The position is part of the key because two steps may share a caption.
            <li
              key={`${position}-${line}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6em",
                fontSize: lineSize,
                lineHeight: 1.2,
                marginBottom: "0.5em",
                // Lines arrive one after another, like a list being written.
                opacity: interpolate(
                  frame,
                  [fade + position * 4, 2 * fade + position * 4],
                  [0, 1],
                  CLAMP,
                ),
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: "1.6em",
                  height: "1.6em",
                  borderRadius: "50%",
                  backgroundColor: settings.colors.accent,
                  color: settings.colors.onAccent,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  fontWeight: 700,
                  fontSize: "0.8em",
                }}
              >
                {position + 1}
              </span>
              {line}
            </li>
          ))}
        </ol>
        <div style={{ fontSize: lineSize, color: settings.colors.cardSubtitle }}>{address}</div>
      </div>
    </AbsoluteFill>
  );
};
