/**
 * Every number and colour the video uses lives in this one file, so the look
 * can be tuned without reading the drawing code.
 *
 * All times are in seconds. They are converted to frames in timeline.ts.
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
    /**
     * Moment inside a scene when the picture changes from the "before"
     * screenshot to the "after" screenshot.
     */
    switchAt: 1.1,
  },

  colors: {
    /** Fills the area around the screenshot. */
    background: "#0f1226",
    captionText: "#ffffff",
    captionBackground: "rgba(15, 18, 38, 0.85)",
  },

  /** Text sizes in output pixels. Phone-shaped video gets larger text. */
  caption: {
    "16:9": { fontSize: 44, bottom: 60 },
    "9:16": { fontSize: 60, bottom: 260 },
  },

  fontFamily: "'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif",
};
