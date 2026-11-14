/**
 * Every number and colour the video uses lives in this one file, so the look
 * can be tuned without reading the drawing code.
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
 * Shared starting point. Each style below changes only the values it needs
 * to, so most tuning that should apply to every style happens here.
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

    /** Click steps: the click (ripple and change of picture) happens here. */
    clickAt: 1.1,
    /** How long the click ripple stays visible. */
    rippleSeconds: 0.5,

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

    /** Title card at the start and the card with the address at the end. */
    titleCardSeconds: 2.0,
    endCardSeconds: 2.5,
    /** How-to videos end with a written list of the steps instead. */
    recapCardSeconds: 5.0,
    /** Fade in and out used by the cards, captions and the window. */
    softFadeSeconds: 0.35,
  },

  /** Where the browser window sits and how hard the camera zooms. */
  layout: {
    "16:9": {
      /** Width of the window. The screenshot is scaled to fit it. */
      windowWidth: 1440,
      /** Vertical centre of the window. */
      windowCenterY: 490,
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
      zoom: 2.2,
      zoomPullToCenter: 0.7,
    },
  },

  window: {
    cornerRadius: 20,
    /** Height of the bar with the three dots and the address. */
    barHeight: 46,
    shadow: "0 40px 110px rgba(0, 0, 0, 0.5), 0 8px 24px rgba(0, 0, 0, 0.25)",
  },

  cursor: {
    /** Height of the arrow. */
    size: 44,
    /** Final width of the click ripple ring. */
    rippleSize: 130,
  },

  colors: {
    /** The backdrop behind the window. */
    backgroundGradient: "linear-gradient(135deg, #12142e 0%, #2f2a7a 55%, #6a48c8 100%)",
    /** The one accent colour: click ripple and typing caret. */
    accent: "#7c6cff",
    windowBar: "#eceef4",
    windowBarText: "#5a6072",
    windowDots: ["#ff5f57", "#febc2e", "#28c840"],
    captionText: "#ffffff",
    captionBackground: "rgba(13, 15, 34, 0.88)",
    typingText: "#161a2b",
    typingBackground: "#ffffff",
    cardTitle: "#ffffff",
    cardSubtitle: "rgba(255, 255, 255, 0.78)",
  },

  /** Caption (subtitle) text. Phone-shaped video gets larger, lower text. */
  caption: {
    "16:9": { fontSize: 42, bottom: 48 },
    "9:16": { fontSize: 64, bottom: 330 },
  },

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
    /** File name inside the app's public folder. */
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
 * The three styles. Each one is the base with a few values replaced.
 *
 * trailer:  faster pacing, stronger zooms. The default for demo videos.
 * tutorial: slower, gentle zooms, a longer pause after each step. The
 *           default for how-to videos.
 * social:   quick cuts, large captions, never longer than 30 seconds.
 */
const presets: Record<Style, Settings> = {
  trailer: {
    ...base,
    timing: paced(0.8),
    layout: {
      "16:9": { ...base.layout["16:9"], zoom: 1.9 },
      "9:16": { ...base.layout["9:16"], zoom: 2.6 },
    },
  },

  tutorial: {
    ...base,
    timing: {
      ...paced(1.15),
      // The action itself finishes after about 2.5 seconds, so these two
      // leave a clear pause before the next step starts.
      sceneSecondsWithoutAudio: 3.6,
      paddingAfterAudio: 1.2,
    },
    layout: {
      "16:9": { ...base.layout["16:9"], zoom: 1.3 },
      "9:16": { ...base.layout["9:16"], zoom: 1.7 },
    },
  },

  social: {
    ...base,
    maxSeconds: 30,
    timing: {
      ...paced(0.7),
      // Quick cuts: short cards and almost no fading between things.
      titleCardSeconds: 1.0,
      endCardSeconds: 1.5,
      recapCardSeconds: 3.0,
      softFadeSeconds: 0.12,
    },
    caption: {
      "16:9": { fontSize: 60, bottom: 44 },
      "9:16": { fontSize: 84, bottom: 300 },
    },
    typingChip: {
      "16:9": { fontSize: 46, bottom: 190 },
      "9:16": { fontSize: 64, bottom: 580 },
    },
  },
};

/** The style used when the caller does not pick one. */
export function defaultStyle(mode: "demo" | "howto"): Style {
  return mode === "howto" ? "tutorial" : "trailer";
}

/** All settings for one style. */
export function settingsFor(style: Style): Settings {
  return presets[style];
}
