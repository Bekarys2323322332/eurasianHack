import { describe, expect, it } from "vitest";
import { getPublicBaseUrl, toPublicUrl } from "../src/shared/publicUrl";

describe("public URL helpers", () => {
  it("returns null when no public base URL is configured", () => {
    expect(getPublicBaseUrl({})).toBeNull();
  });

  it("trims whitespace and trailing slashes from a valid URL", () => {
    expect(getPublicBaseUrl({ PUBLIC_BASE_URL: " https://example.com/share/// " })).toBe(
      "https://example.com/share",
    );
  });

  it("rejects invalid and non-HTTP URLs", () => {
    expect(getPublicBaseUrl({ PUBLIC_BASE_URL: "not a URL" })).toBeNull();
    expect(getPublicBaseUrl({ PUBLIC_BASE_URL: "ftp://example.com" })).toBeNull();
  });

  it("joins a base and path regardless of slash variations", () => {
    expect(toPublicUrl("/video/123", "https://example.com/")).toBe(
      "https://example.com/video/123",
    );
    expect(toPublicUrl("video/123", "https://example.com")).toBe(
      "https://example.com/video/123",
    );
    expect(toPublicUrl("//video/123", "https://example.com///")).toBe(
      "https://example.com/video/123",
    );
  });
});
