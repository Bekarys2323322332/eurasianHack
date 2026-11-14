/**
 * The one place that lists which languages and voices narration can use.
 *
 * Only languages and voices that were actually run through the provider and
 * through the renderer are listed here. To add one: generate a line with it
 * (npm run voice -- --job <folder> --language xx --voice name), check the
 * result, then add it below.
 *
 * Voice names are the ones the provider accepts in its "voice" field. The
 * model is multilingual, so the same voices work for every language; the
 * language of the speech follows the language of the text.
 */
/** The speech model used for every line. Handles English and Russian. */
export const MODEL = "elevenlabs/eleven-multilingual-v2";

/**
 * What the model above costs, in US dollars per character of text sent to
 * it (80 dollars per million characters on OpenRouter). The voice cost of a
 * job is worked out from this, so change it together with MODEL.
 */
export const PRICE_PER_CHARACTER_USD = 0.00008;

export interface LanguageConfig {
  /** Shown to people, e.g. in a language picker. */
  label: string;
  /** Used when the caller does not pick a voice. */
  defaultVoice: string;
  /** Every voice that was tested for this language. */
  voices: string[];
}

export const LANGUAGES: Record<string, LanguageConfig> = {
  en: { label: "English", defaultVoice: "sarah", voices: ["sarah", "george"] },
  ru: { label: "Russian", defaultVoice: "sarah", voices: ["sarah", "george"] },
};

/**
 * Work out which voice to use, or throw a plain-words error that says what
 * the valid choices are.
 */
export function resolveVoice(language: string, voice?: string): string {
  const config = LANGUAGES[language];
  if (!config) {
    throw new Error(
      `Narration is not set up for language "${language}". ` +
        `Available: ${Object.keys(LANGUAGES).join(", ")}.`,
    );
  }
  if (!voice) return config.defaultVoice;
  if (!config.voices.includes(voice)) {
    throw new Error(
      `Voice "${voice}" has not been tested for ${config.label}. ` +
        `Available: ${config.voices.join(", ")}.`,
    );
  }
  return voice;
}
