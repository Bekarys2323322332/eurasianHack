/**
 * Every number, colour and design choice the video uses lives in this one
 * file, so the look can be tuned without reading the drawing code.
 *
 * There are three styles (trailer, tutorial, social). Each is a plain
 * object further down: the shared base with that style's own colours,
 * caption design, transition, cursor and pacing written over it.
 *
 * All times are in seconds. They are converted to frames in timeline.ts.
 * All sizes are in output pixels (1920x1080 or 1080x1920) unless a comment
 * says otherwise.
 */
/** Frames per second of the finished video. The same for every style. */
export const FPS = 30;

/** The three looks a video can have. */
export type Style = "trailer" | "tutorial" | "social";

/**
 * Shared starting point. Each style below changes the values it needs to.
 */
const base = {
  /**
   * Longest the whole video may be, in seconds, or null for no limit.
   * When a video would run over, steps are dropped from the end.
   */
  maxSeconds: null as number | null,

  /** Output size in pixels for each shape of video. */
  sizes: {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
  },

  /** The design choices that make the styles look different at a glance. */
  look: {
    /**
     * What sits behind the page. "color" paints colors.background.
     * "blurredPage" fills the whole frame with a blurred, darkened copy of
     * the screenshot, so the picture runs edge to edge.
     */
    backdrop: "color" as "color" | "blurredPage",
    /**
     * True: the page sits in a browser window with a top bar, round corners
     * and a shadow. False: the bare page, edge to edge.
     */
    windowChrome: true,
    /**
     * How one scene hands over to the next. "glide" slides the old scene
     * out to the left and the new one in from the right. "fade" fades out
     * and in. "cut" switches instantly.
     */
    sceneTransition: "fade" as "glide" | "fade" | "cut",
    /** Length of each half (out, then in) of a glide or fade. */
    sceneTransitionSeconds: 0.25,
    /**
     * "words": big text that pops in one word at a time.
     * "bar": small text in a full-width bar along the bottom.
     * "highlight": very large centred text with the key word marked.
     */
    captionDesign: "bar" as "words" | "bar" | "highlight",
    /** Show caption text in capital letters. */
    captionUppercase: false,
    /** "arrow" is a mouse pointer. "dot" is a round touch marker. */
    cursorDesign: "arrow" as "arrow" | "dot",
    /**
     * What marks a click. "ripple" is a ring that bursts outwards and is
     * gone. "ring" is a steady ring around the clicked element that shows
     * up when the cursor arrives and stays for a moment after the click.
     */
    clickMark: "ripple" as "ripple" | "ring",
    /** "bold": huge capital letters. "simple": modest, plain. */
    cardDesign: "simple" as "bold" | "simple",
    /** A thin bar across the top that fills up as the video plays. */
    progressBar: false,
  },

  timing: {
    /** Scene length when the step has no narration audio. */
    sceneSecondsWithoutAudio: 2.5,
    /** Breathing room added after the narration audio ends. */
    paddingAfterAudio: 0.6,

    /** The cursor travels from the previous step's spot to this one. */
    cursorGlideStart: 0.0,
    cursorGlideEnd: 0.8,

    /** The camera moves in towards the click spot. */
    zoomInStart: 0.2,
    zoomInEnd: 0.9,
    /** After the picture changes, wait this long, then move back out. */
    zoomHoldAfterSwitch: 0.3,
    zoomOutSeconds: 0.6,

    /** Click steps: the click (mark and change of picture) happens here. */
    clickAt: 1.1,
    /** How long the click ripple stays visible. */
    rippleSeconds: 0.5,
    /** Click mark "ring": how long it stays after the click. */
    ringHoldSeconds: 0.9,

    /** Type steps: the cursor clicks the field, then the letters appear. */
    typeClickAt: 0.8,
    typeStart: 0.9,
    typeEnd: 1.6,

    /** Scroll steps: the page slides up to the "after" picture. */
    scrollStart: 0.9,
    scrollSeconds: 0.7,

    /** Navigate and wait steps: a short cross-fade between the pictures. */
    fadeAt: 1.1,
    fadeSeconds: 0.3,

    /**
     * Title card at the start (0 means no title card: the video opens on
     * the first step) and the card with the address at the end.
     */
    titleCardSeconds: 2.0,
    endCardSeconds: 2.5,
    /** How-to videos end with a written list of the steps instead. */
    recapCardSeconds: 5.0,
    /** Fade in and out used by the cards and small pieces of text. */
    softFadeSeconds: 0.35,
  },

  /** Where the page sits and how hard the camera zooms. */
  layout: {
    "16:9": {
      /** Width of the window. The screenshot is scaled to fit it. */
      windowWidth: 1440,
      /** Vertical centre of the window. */
      windowCenterY: 490,
      /**
       * How big the page is shown between actions (1 is its natural size in
       * the window). Above 1 the camera stays slightly zoomed in and follows
       * the cursor, which keeps real pages readable in the narrow 9:16 shape.
       */
      restZoom: 1,
      /** How much bigger the picture gets around the click spot. */
      zoom: 1.6,
      /**
       * While zoomed, slide the click spot this far towards the middle of
       * the frame. 0 leaves it where it is, 1 puts it dead centre.
       */
      zoomPullToCenter: 0.35,
    },
    "9:16": {
      windowWidth: 1040,
      windowCenterY: 780,
      restZoom: 1.45,
      zoom: 2.2,
      zoomPullToCenter: 0.7,
    },
  },

  /** Only used when look.windowChrome is true, except for the shadow. */
  window: {
    cornerRadius: 20,
    /** Height of the bar with the three dots and the address. */
    barHeight: 46,
    shadow: "0 40px 110px rgba(0, 0, 0, 0.5), 0 8px 24px rgba(0, 0, 0, 0.25)",
  },

  cursor: {
    /** Height of the arrow, or width of the dot. */
    size: 44,
    /** Final width of the click ripple, or width of the steady ring. */
    markSize: 130,
  },

  colors: {
    /** Fills the frame behind everything (any CSS background). */
    background: "#101223",
    /** The style's one accent colour. */
    accent: "#7c6cff",
    /** Text drawn on top of the accent colour. */
    onAccent: "#ffffff",
    windowBar: "#eceef4",
    windowBarText: "#5a6072",
    windowDots: ["#ff5f57", "#febc2e", "#28c840"],
    captionText: "#ffffff",
    /** Caption bar fill ("bar" design only). */
    captionBackground: "#ffffff",
    typingText: "#161a2b",
    typingBackground: "#ffffff",
    cursorFill: "#111111",
    cursorEdge: "#ffffff",
    cardTitle: "#ffffff",
    cardSubtitle: "rgba(255, 255, 255, 0.78)",
  },

  /**
   * Caption text size and distance from the bottom edge. A caption that
   * would need more than maxLines lines is drawn smaller until it fits.
   */
  caption: {
    "16:9": { fontSize: 42, bottom: 48, maxLines: 2 },
    "9:16": { fontSize: 64, bottom: 330, maxLines: 3 },
  },

  /**
   * Titles on the cards never take more lines than this. Longer titles are
   * drawn smaller, and cut off with "..." if they are still too long.
   */
  cardTitleMaxLines: 3,

  /** The chip that shows typed text letter by letter. Sits above the caption. */
  typingChip: {
    "16:9": { fontSize: 40, bottom: 160 },
    "9:16": { fontSize: 58, bottom: 560 },
  },

  /** Title and end cards. */
  cards: {
    "16:9": { titleSize: 120, subtitleSize: 44 },
    "9:16": { titleSize: 110, subtitleSize: 50 },
  },

  /** How-to videos: the "1 of 6" badge shown on every step. */
  badge: {
    "16:9": { fontSize: 34, left: 40, top: 40 },
    "9:16": { fontSize: 52, left: 40, top: 300 },
  },

  /** How-to videos: the written list of steps on the end card. */
  recap: {
    "16:9": { headingSize: 64, lineSize: 44 },
    "9:16": { headingSize: 68, lineSize: 48 },
  },

  /**
   * The only fixed words the renderer puts on screen. They are English;
   * change them here if videos in other languages need them.
   */
  words: {
    /** Title of a how-to video: "How to" followed by the goal. */
    howTo: "How to",
    /** Step badge: "1 of 6". */
    of: "of",
  },

  music: {
    /**
     * Music files in the app's public folder. The style's own file is used
     * when it exists, otherwise the shared one, otherwise no music.
     */
    styleFile: "music.mp3",
    file: "music.mp3",
    /** Loudness of the music on its own (1 is full volume). */
    volume: 0.22,
    /** Loudness of the music while narration is playing. */
    volumeUnderNarration: 0.06,
    /** How quickly the music drops and comes back around narration. */
    rampSeconds: 0.3,
    /** Fade out at the very end of the video. */
    fadeOutSeconds: 1.0,
  },

  fontFamily: "'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif",
};

export type Settings = typeof base;

/** Multiply every time in the base by one number: below 1 is faster. */
const paced = (factor: number) =>
  Object.fromEntries(
    Object.entries(base.timing).map(([name, seconds]) => [name, seconds * factor]),
  ) as Settings["timing"];

/**
 * TRAILER. Dark stage with a bold two-colour glow, a big white pointer,
 * strong zooms, scenes that glide in from the side, and large capital
 * captions that pop in word by word. The default for demo videos.
 */
const trailer: Settings = {
  ...base,
  look: {
    ...base.look,
    sceneTransition: "glide",
    sceneTransitionSeconds: 0.2,
    captionDesign: "words",
    captionUppercase: true,
    cursorDesign: "arrow",
    clickMark: "ripple",
    cardDesign: "bold",
  },
  timing: paced(0.8),
  layout: {
    "16:9": { windowWidth: 1360, windowCenterY: 450, restZoom: 1, zoom: 1.9, zoomPullToCenter: 0.45 },
    "9:16": { windowWidth: 1040, windowCenterY: 760, restZoom: 1.5, zoom: 2.6, zoomPullToCenter: 0.7 },
  },
  window: {
    ...base.window,
    shadow: "0 50px 140px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08)",
  },
  cursor: { size: 58, markSize: 170 },
  colors: {
    ...base.colors,
    background:
      "radial-gradient(ellipse at 12% 8%, #ff2e63 0%, rgba(255, 46, 99, 0) 55%), " +
      "radial-gradient(ellipse at 92% 96%, #7b2ff7 0%, rgba(123, 47, 247, 0) 60%), #09090f",
    accent: "#ff2e63",
    cursorFill: "#ffffff",
    cursorEdge: "#111111",
  },
  caption: {
    "16:9": { fontSize: 78, bottom: 64, maxLines: 2 },
    "9:16": { fontSize: 92, bottom: 360, maxLines: 3 },
  },
  typingChip: {
    "16:9": { fontSize: 42, bottom: 200 },
    "9:16": { fontSize: 58, bottom: 640 },
  },
  cards: {
    "16:9": { titleSize: 190, subtitleSize: 48 },
    "9:16": { titleSize: 150, subtitleSize: 52 },
  },
  music: { ...base.music, styleFile: "music-trailer.mp3" },
};

/**
 * TUTORIAL. Light, calm page colours, a normal black pointer, gentle zooms,
 * soft fades, a steady ring that marks what is being clicked, and small
 * captions in a clean bar along the bottom. Slower, with a pause after each
 * step. The default for how-to videos.
 */
const tutorial: Settings = {
  ...base,
  look: {
    ...base.look,
    sceneTransition: "fade",
    sceneTransitionSeconds: 0.35,
    captionDesign: "bar",
    cursorDesign: "arrow",
    clickMark: "ring",
    cardDesign: "simple",
  },
  timing: {
    ...paced(1.15),
    // The action itself finishes after about 2.5 seconds, so these two
    // leave a clear pause before the next step starts.
    sceneSecondsWithoutAudio: 3.6,
    paddingAfterAudio: 1.2,
  },
  layout: {
    "16:9": { windowWidth: 1400, windowCenterY: 480, restZoom: 1, zoom: 1.3, zoomPullToCenter: 0.35 },
    "9:16": { windowWidth: 1000, windowCenterY: 800, restZoom: 1.4, zoom: 1.9, zoomPullToCenter: 0.7 },
  },
  window: {
    ...base.window,
    cornerRadius: 14,
    shadow: "0 24px 60px rgba(40, 60, 100, 0.2), 0 0 0 1px rgba(40, 60, 100, 0.1)",
  },
  cursor: { size: 44, markSize: 96 },
  colors: {
    ...base.colors,
    background: "linear-gradient(180deg, #f7f9fc 0%, #e2e9f4 100%)",
    accent: "#2563eb",
    captionText: "#1c2333",
    captionBackground: "#ffffff",
    cardTitle: "#1c2333",
    cardSubtitle: "#5a657d",
  },
  caption: {
    // For the bar design, "bottom" is extra space under the text inside
    // the bar (phones often cover the very bottom edge).
    "16:9": { fontSize: 34, bottom: 0, maxLines: 2 },
    "9:16": { fontSize: 54, bottom: 70, maxLines: 3 },
  },
  typingChip: {
    "16:9": { fontSize: 36, bottom: 130 },
    "9:16": { fontSize: 50, bottom: 620 },
  },
  cards: {
    "16:9": { titleSize: 84, subtitleSize: 38 },
    "9:16": { titleSize: 80, subtitleSize: 42 },
  },
  music: { ...base.music, styleFile: "music-tutorial.mp3" },
};

/**
 * SOCIAL. Made for the tall 9:16 shape. No window and no title card: the
 * page runs edge to edge over a blurred copy of itself and the video opens
 * on the first action. Hard cuts, a round touch marker instead of a pointer,
 * very large centred captions with the key word highlighted, and a progress
 * bar across the top. Never longer than 30 seconds.
 */
const social: Settings = {
  ...base,
  maxSeconds: 30,
  look: {
    ...base.look,
    backdrop: "blurredPage",
    windowChrome: false,
    sceneTransition: "cut",
    captionDesign: "highlight",
    captionUppercase: true,
    cursorDesign: "dot",
    clickMark: "ripple",
    cardDesign: "bold",
    progressBar: true,
  },
  timing: {
    ...paced(0.7),
    titleCardSeconds: 0,
    endCardSeconds: 1.5,
    recapCardSeconds: 3.0,
    softFadeSeconds: 0.1,
  },
  layout: {
    // The page fills the full width of the frame in both shapes.
    "16:9": { windowWidth: 1920, windowCenterY: 540, restZoom: 1, zoom: 1.5, zoomPullToCenter: 0.5 },
    "9:16": { windowWidth: 1080, windowCenterY: 700, restZoom: 1.6, zoom: 2.4, zoomPullToCenter: 0.7 },
  },
  window: { ...base.window, cornerRadius: 0, shadow: "0 0 90px rgba(0, 0, 0, 0.65)" },
  cursor: { size: 64, markSize: 190 },
  colors: {
    ...base.colors,
    background: "#0b0b10",
    accent: "#ffe600",
    onAccent: "#111111",
    cursorFill: "rgba(255, 230, 0, 0.85)",
    cursorEdge: "#111111",
  },
  caption: {
    "16:9": { fontSize: 88, bottom: 70, maxLines: 2 },
    "9:16": { fontSize: 116, bottom: 300, maxLines: 3 },
  },
  typingChip: {
    "16:9": { fontSize: 46, bottom: 240 },
    "9:16": { fontSize: 62, bottom: 800 },
  },
  cards: {
    "16:9": { titleSize: 170, subtitleSize: 50 },
    "9:16": { titleSize: 150, subtitleSize: 56 },
  },
  badge: {
    "16:9": { fontSize: 34, left: 40, top: 50 },
    "9:16": { fontSize: 52, left: 40, top: 60 },
  },
  music: { ...base.music, styleFile: "music-social.mp3" },
};

const presets: Record<Style, Settings> = { trailer, tutorial, social };

/** The style used when the caller does not pick one. */
export function defaultStyle(mode: "demo" | "howto"): Style {
  return mode === "howto" ? "tutorial" : "trailer";
}

/** All settings for one style. */
export function settingsFor(style: Style): Settings {
  return presets[style];
}
