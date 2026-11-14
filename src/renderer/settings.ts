/**
 * Every number and colour the video uses lives in this one file, so the look
 * can be tuned without reading the drawing code.
 *
 * All times are in seconds. They are converted to frames in timeline.ts.
 * All sizes are in output pixels (1920x1080 or 1080x1920) unless a comment
 * says otherwise.
 */
export const settings = {
  /** Frames per second of the finished video. */
  fps: 30,

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
