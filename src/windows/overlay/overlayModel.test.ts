import { describe, expect, it } from "vitest";
import { I18N } from "../../lib/i18n";
import {
  SOURCE_LANGUAGE_DISPLAY_NAMES,
  type SubtitleSnapshot,
} from "../../lib/types";
import {
  computeActivityPhaseFromSignals,
  computeVisibleRows,
  sourceLanguageButtonTitle,
  visibleLiveSubtitle,
  visibleLiveSubtitles,
} from "./overlayModel";

const settings = {
  sourceLanguage: "auto" as const,
  targetLanguage: "zh" as const,
};

function subtitles(
  source: SubtitleSnapshot["source"],
  translation: SubtitleSnapshot["translation"] = {
    text: "",
    isFinal: false,
  },
  history: SubtitleSnapshot["history"] = [],
): SubtitleSnapshot {
  return { source, translation, history };
}

describe("live subtitle display mode", () => {
  it("prefers a translation draft over source recognition", () => {
    expect(
      visibleLiveSubtitle(
        subtitles(
          { text: "source draft", isFinal: false },
          { text: "译文草稿", isFinal: false },
        ),
        settings,
        "en",
        false,
        false,
      ),
    ).toEqual({ text: "译文草稿", isFinal: false, kind: "translation" });
  });

  it("does not flash source recognition before the first translation", () => {
    expect(
      visibleLiveSubtitle(
        subtitles({ text: "still recognizing", isFinal: false }),
        settings,
        "en",
        false,
        false,
      ),
    ).toBeNull();
  });

  it("does not replace missing translation with source after timeout", () => {
    expect(
      visibleLiveSubtitle(
        subtitles(
          { text: "recognized final", isFinal: true },
          { text: "", isFinal: true },
          [
            {
              source: "previous source",
              translation: "上一句译文",
              createdAt: 1,
            },
          ],
        ),
        settings,
        "en",
        false,
        true,
      ),
    ).toBeNull();
  });

  it("treats same-language recognition as final subtitle text", () => {
    expect(
      visibleLiveSubtitle(
        subtitles({ text: "中文识别结果", isFinal: true }),
        settings,
        "zh",
        false,
        false,
      ),
    ).toEqual({ text: "中文识别结果", isFinal: true, kind: "source" });
  });

  it("does not duplicate a source final already committed to history", () => {
    const history = [
      {
        source: "finished source",
        translation: "完成的译文",
        createdAt: 1,
      },
    ];
    expect(
      visibleLiveSubtitle(
        subtitles(
          { text: "finished source", isFinal: true },
          { text: "完成的译文", isFinal: true },
          history,
        ),
        settings,
        "en",
        false,
        false,
      ),
    ).toBeNull();
  });

  it("does not append a repeated source while the next translation is pending", () => {
    const history = [
      {
        source: "repeated lyric",
        translation: "重复歌词",
        createdAt: 1,
      },
    ];
    expect(
      visibleLiveSubtitle(
        subtitles(
          { text: "repeated lyric", isFinal: true },
          { text: "重复歌词", isFinal: true },
          history,
        ),
        settings,
        "en",
        true,
        false,
      ),
    ).toBeNull();
  });

  it("does not append a repeated source after its translation times out", () => {
    const history = [
      {
        source: "repeated lyric",
        translation: "上一遍歌词",
        createdAt: 1,
      },
    ];
    expect(
      visibleLiveSubtitle(
        subtitles(
          { text: "repeated lyric", isFinal: true },
          { text: "上一遍歌词", isFinal: true },
          history,
        ),
        settings,
        "en",
        false,
        true,
      ),
    ).toBeNull();
  });

  it("keeps recognition visible in explicitly selected original mode", () => {
    expect(
      visibleLiveSubtitle(
        subtitles({ text: "original draft", isFinal: false }),
        { ...settings, targetLanguage: "original" },
        "en",
        false,
        false,
      ),
    ).toEqual({ text: "original draft", isFinal: false, kind: "source" });
  });

  it("waits for translation while automatic source language is unknown", () => {
    expect(
      visibleLiveSubtitle(
        subtitles({ text: "unclassified draft", isFinal: false }),
        settings,
        null,
        true,
        false,
      ),
    ).toBeNull();
  });
});

describe("source language labels", () => {
  it("labels Chinese as original-only only when the active provider supports that mode", () => {
    expect(sourceLanguageButtonTitle("zh", true)).toBe(
      I18N.overlay.chineseSource,
    );
    expect(sourceLanguageButtonTitle("zh", false)).toBe(
      SOURCE_LANGUAGE_DISPLAY_NAMES.zh,
    );
  });
});

describe("activity phase signals", () => {
  const base = {
    statusKind: "listening" as const,
    isPaused: false,
    detectedLanguage: "ja",
    isTranslationPending: false,
    hasRecognizingSourceDraft: false,
  };

  it("distinguishes recognizing and translating without subtitle text", () => {
    expect(
      computeActivityPhaseFromSignals(
        { ...base, hasRecognizingSourceDraft: true },
        settings,
      ),
    ).toBe("recognizing");
    expect(
      computeActivityPhaseFromSignals(
        { ...base, isTranslationPending: true },
        settings,
      ),
    ).toBe("translating");
  });

  it("keeps pause and lifecycle transitions ahead of stream activity", () => {
    expect(
      computeActivityPhaseFromSignals(
        { ...base, isPaused: true, isTranslationPending: true },
        settings,
      ),
    ).toBe("paused");
    expect(
      computeActivityPhaseFromSignals(
        { ...base, statusKind: "stopping", hasRecognizingSourceDraft: true },
        settings,
      ),
    ).toBe("connecting");
  });

  it.each(["error", "idle"] as const)(
    "never reports %s as listening even when stream or pause flags remain",
    (statusKind) => {
      expect(
        computeActivityPhaseFromSignals(
          {
            ...base,
            statusKind,
            isPaused: true,
            isTranslationPending: true,
            hasRecognizingSourceDraft: true,
          },
          settings,
        ),
      ).toBe(statusKind);
    },
  );
});


describe("subtitle display preference", () => {
  const pair = { source: "Hello world", translation: "你好世界", createdAt: 1 };

  it("preserves translation-only history and selects original without changing the target", () => {
    expect(computeVisibleRows([pair], 28).map((row) => row.text)).toEqual(["你好世界"]);
    expect(computeVisibleRows([pair], 28, "original", 64).map((row) => row.text)).toEqual(["Hello world"]);
    expect(visibleLiveSubtitle(
      subtitles({ text: "New source", isFinal: false }, { text: "旧译文", isFinal: false }),
      { ...settings, subtitleDisplayMode: "original" }, "en", true, false,
    )).toEqual({ text: "New source", isFinal: false, kind: "source" });
  });

  it("groups each committed source with its own translation and one timestamp", () => {
    const rows = computeVisibleRows([pair, { ...pair, source: "Next", translation: "下一句", createdAt: 2 }], 28, "bilingual", 64);
    expect(rows.map((row) => row.text)).toEqual(["Hello world", "你好世界", "Next", "下一句"]);
    expect(rows.map((row) => row.createdAt)).toEqual([1, null, 2, null]);
    expect(rows[0].pairId).toBe(rows[1].pairId);
    expect(rows[1].pairId).not.toBe(rows[2].pairId);
  });

  it("does not duplicate same-language or original-target history", () => {
    const same = { ...pair, translation: pair.source };
    expect(computeVisibleRows([same], 64, "bilingual", 64).map((row) => row.text)).toEqual([pair.source]);
  });

  it("keeps sources with empty translations and never substitutes translations for missing originals", () => {
    expect(computeVisibleRows([{ ...pair, translation: "" }], 28, "bilingual", 64).map((row) => row.text)).toEqual([pair.source]);
    expect(computeVisibleRows([{ ...pair, source: "" }], 28, "original", 64)).toEqual([]);
  });

  it("segments both languages independently without losing the pairing", () => {
    const rows = computeVisibleRows([{ ...pair, source: "a".repeat(130), translation: "你".repeat(60) }], 28, "bilingual", 64);
    expect(rows.filter((row) => row.kind === "source").map((row) => row.text.length)).toEqual([64, 64, 2]);
    expect(rows.filter((row) => row.kind === "translation").map((row) => row.text.length)).toEqual([28, 28, 4]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows.filter((row) => row.createdAt !== null)).toHaveLength(1);
  });

  it.each([
    [true, false],
    [false, true],
    [false, false],
  ])("never pairs new recognition with a stale translation (pending %s, timeout %s)", (pending, timedOut) => {
    const snapshot = subtitles(
      { text: "Next source", isFinal: true },
      { text: pair.translation, isFinal: true },
      [pair],
    );
    expect(visibleLiveSubtitle(snapshot, { ...settings, subtitleDisplayMode: "bilingual" }, "en", pending, timedOut))
      .toEqual({ text: "Next source", isFinal: true, kind: "source" });
  });

  it.each(["original", "bilingual"] as const)("removes the %s preview once its pair is committed", (subtitleDisplayMode) => {
    expect(visibleLiveSubtitle(
      subtitles({ text: pair.source, isFinal: true }, { text: pair.translation, isFinal: true }, [pair]),
      { ...settings, subtitleDisplayMode }, "en", false, false,
    )).toBeNull();
    expect(visibleLiveSubtitle(
      subtitles({ text: "", isFinal: false }),
      { ...settings, subtitleDisplayMode }, "en", false, false,
    )).toBeNull();
  });
});


describe("asynchronous bilingual stream arrival", () => {
  it.each([false, true])("keeps a translation without source visible (final %s)", (isFinal) => {
    expect(visibleLiveSubtitle(
      subtitles({ text: "", isFinal: false }, { text: "Available translation", isFinal }),
      { ...settings, subtitleDisplayMode: "bilingual" }, "en", false, false,
    )).toEqual({ text: "Available translation", isFinal, kind: "translation" });
  });

  it.each(["bilingual", "original"] as const)("does not repeat the committed source when the next translation arrives first in %s mode", (subtitleDisplayMode) => {
    expect(visibleLiveSubtitle(
      subtitles(
        { text: "Previous source", isFinal: true },
        { text: "下一句译文", isFinal: false },
        [{ source: "Previous source", translation: "上一句译文", createdAt: 1 }],
      ),
      { ...settings, subtitleDisplayMode }, "en", false, false,
    )).toBeNull();
  });

  it("does not hide an actual repeated source while its translation is pending", () => {
    expect(visibleLiveSubtitle(
      subtitles(
        { text: "Repeated lyric", isFinal: true },
        { text: "重复歌词", isFinal: true },
        [{ source: "Repeated lyric", translation: "重复歌词", createdAt: 1 }],
      ),
      { ...settings, subtitleDisplayMode: "bilingual" }, "en", true, false,
    )).toEqual({ text: "Repeated lyric", isFinal: true, kind: "source" });
  });
});

describe("bilingual preview rows", () => {
  it("previews the original and its streaming translation together", () => {
    expect(visibleLiveSubtitles(
      subtitles(
        { text: "We next bring our cautery device.", isFinal: false },
        { text: "接下来，我们使用电凝设备。", isFinal: false },
      ),
      { ...settings, subtitleDisplayMode: "bilingual" }, "en", true, false,
    )).toEqual([
      { text: "We next bring our cautery device.", isFinal: false, kind: "source" },
      { text: "接下来，我们使用电凝设备。", isFinal: false, kind: "translation" },
    ]);
  });

  it("keeps one preview row outside bilingual mode", () => {
    const snapshot = subtitles(
      { text: "We next bring our cautery device.", isFinal: false },
      { text: "接下来，我们使用电凝设备。", isFinal: false },
    );
    expect(visibleLiveSubtitles(snapshot, { ...settings, subtitleDisplayMode: "translation" }, "en", true, false))
      .toEqual([{ text: "接下来，我们使用电凝设备。", isFinal: false, kind: "translation" }]);
    expect(visibleLiveSubtitles(snapshot, { ...settings, subtitleDisplayMode: "original" }, "en", true, false))
      .toEqual([{ text: "We next bring our cautery device.", isFinal: false, kind: "source" }]);
  });

  it("drops a committed pair from the previews and keeps the next translation", () => {
    const committed = { source: "Previous source", translation: "上一句译文", createdAt: 1 };
    expect(visibleLiveSubtitles(
      subtitles({ text: "Previous source", isFinal: true }, { text: "上一句译文", isFinal: true }, [committed]),
      { ...settings, subtitleDisplayMode: "bilingual" }, "en", false, false,
    )).toEqual([]);
    expect(visibleLiveSubtitles(
      subtitles({ text: "Previous source", isFinal: true }, { text: "下一句译文", isFinal: false }, [committed]),
      { ...settings, subtitleDisplayMode: "bilingual" }, "en", false, false,
    )).toEqual([{ text: "下一句译文", isFinal: false, kind: "translation" }]);
  });

  it("never stacks the same recognition and translation text twice", () => {
    expect(visibleLiveSubtitles(
      subtitles(
        { text: "今日は晴れです。", isFinal: false },
        { text: "今日は晴れです。", isFinal: false },
      ),
      { sourceLanguage: "ja", targetLanguage: "original", subtitleDisplayMode: "bilingual" }, "ja", false, false,
    )).toEqual([{ text: "今日は晴れです。", isFinal: false, kind: "source" }]);
  });

  it.each([
    { sourceLanguage: "ja" as const, targetLanguage: "original" as const, detectedLanguage: "ja" },
    { sourceLanguage: "auto" as const, targetLanguage: "ja" as const, detectedLanguage: "ja" },
  ])("keeps one language when same-language drafts briefly differ", ({ sourceLanguage, targetLanguage, detectedLanguage }) => {
    expect(visibleLiveSubtitles(
      subtitles(
        { text: "今日は晴れ", isFinal: false },
        { text: "今日は晴れです。", isFinal: false },
      ),
      { sourceLanguage, targetLanguage, subtitleDisplayMode: "bilingual" }, detectedLanguage, false, false,
    )).toEqual([{ text: "今日は晴れ", isFinal: false, kind: "source" }]);
  });

  it("stacks previews only while both lines belong to the same utterance", () => {
    const streaming = (sourceUtterance: string | null, translationUtterance: string | null) =>
      subtitles(
        { text: "Next sentence", isFinal: false, utteranceId: sourceUtterance },
        { text: "下一句", isFinal: false, utteranceId: translationUtterance },
      );
    const bilingual = { ...settings, subtitleDisplayMode: "bilingual" } as const;

    expect(visibleLiveSubtitles(streaming("item_a", "item_a"), bilingual, "en", false, false)).toEqual([
      { text: "Next sentence", isFinal: false, kind: "source" },
      { text: "下一句", isFinal: false, kind: "translation" },
    ]);
    // The translation still answers the previous sentence: the original stays
    // alone instead of pairing the two streams by arrival order.
    expect(visibleLiveSubtitles(streaming("item_b", "item_a"), bilingual, "en", false, false)).toEqual([
      { text: "Next sentence", isFinal: false, kind: "source" },
    ]);
    // A translation whose utterance is unknown must not stack either: it can
    // still be the previous sentence's text.
    expect(visibleLiveSubtitles(streaming("item_b", null), bilingual, "en", false, false)).toEqual([
      { text: "Next sentence", isFinal: false, kind: "source" },
    ]);
    // Providers without utterance identity keep stacking both streams.
    expect(visibleLiveSubtitles(streaming(null, null), bilingual, "en", false, false)).toEqual([
      { text: "Next sentence", isFinal: false, kind: "source" },
      { text: "下一句", isFinal: false, kind: "translation" },
    ]);
  });
});
