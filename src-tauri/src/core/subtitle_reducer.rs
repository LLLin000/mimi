//! Subtitle assembly state machine for drafts, confirmed pairs, and bounded
//! history.
//!
//! Providers that stream recognition and translation independently pair them by
//! the identity their own protocol carries and commit one atomic
//! [`SubtitleEvent::FinalPair`]. [`SubtitleEvent::TranslationFinal`] remains the
//! best-effort path for a stream without identity: the translation is paired
//! with the recognition line currently on screen.

use crate::core::models::{
    SubtitleEvent, SubtitleLine, SubtitlePair, SubtitleSnapshot, UtteranceRole,
};

pub struct SubtitleReducer {
    pub snapshot: SubtitleSnapshot,
    pub archive: super::session_archive::TranscriptArchive,
    max_history_count: usize,
}

impl SubtitleReducer {
    pub fn new(max_history_count: usize) -> Self {
        Self {
            snapshot: SubtitleSnapshot::empty(),
            archive: Default::default(),
            max_history_count,
        }
    }

    pub fn apply(&mut self, event: SubtitleEvent) {
        match event {
            SubtitleEvent::SourceDraft(text) => {
                self.snapshot.source = SubtitleLine::new(trim(&text), false);
            }
            SubtitleEvent::SourceFinal(text) => {
                self.snapshot.source = SubtitleLine::new(trim(&text), true);
            }
            SubtitleEvent::TranslationDraft(text) => {
                let trimmed = trim(&text);
                // A blank draft must not overwrite an already-confirmed final.
                if trimmed.is_empty() && self.snapshot.translation.is_final {
                    return;
                }
                self.snapshot.translation = SubtitleLine::new(trimmed, false);
            }
            SubtitleEvent::UtteranceText {
                utterance_id,
                role,
                text,
                is_final,
            } => {
                let text = trim(&text);
                match role {
                    UtteranceRole::Source => {
                        self.snapshot.source =
                            SubtitleLine::for_utterance(text, is_final, utterance_id);
                    }
                    UtteranceRole::Translation => {
                        if text.is_empty() && self.snapshot.translation.is_final {
                            return;
                        }
                        self.snapshot.translation =
                            SubtitleLine::for_utterance(text.clone(), is_final, utterance_id);
                        if is_final {
                            let source = self.snapshot.source.text.clone();
                            self.append_history_if_possible(source, text);
                        }
                    }
                }
            }
            SubtitleEvent::TranslationFinal(text) => {
                let translation = trim(&text);
                self.snapshot.translation = SubtitleLine::new(translation.clone(), true);
                let source = self.snapshot.source.text.clone();
                self.append_history_if_possible(source, translation);
            }
            SubtitleEvent::FinalPair {
                source,
                translation,
            } => {
                let source = trim(&source);
                let translation = trim(&translation);
                self.snapshot.source = SubtitleLine::new(source.clone(), true);
                self.snapshot.translation = SubtitleLine::new(translation.clone(), true);
                self.append_history_if_possible(source, translation);
            }
            SubtitleEvent::Clear => {
                self.archive.clear();
                self.snapshot = SubtitleSnapshot::empty();
            }
        }
    }

    /// Drops generation-local state while preserving confirmed history and any
    /// fully confirmed line still displayed: an unconfirmed line belongs to the
    /// connection that produced it.
    pub fn reset_transient(&mut self) {
        if !self.snapshot.source.is_final {
            self.snapshot.source = SubtitleLine::new("", false);
        }
        if !self.snapshot.translation.is_final {
            self.snapshot.translation = SubtitleLine::new("", false);
        }
    }

    fn append_history_if_possible(&mut self, source: String, translation: String) {
        if source.is_empty() || translation.is_empty() {
            return;
        }
        let pair = SubtitlePair::new(source, translation, now_epoch_ms());
        if self.snapshot.history.last() == Some(&pair) {
            return;
        }
        self.archive.append(&pair);
        self.snapshot.history.push(pair);
        if self.snapshot.history.len() > self.max_history_count {
            let overflow = self.snapshot.history.len() - self.max_history_count;
            self.snapshot.history.drain(0..overflow);
        }
    }
}

impl Default for SubtitleReducer {
    fn default() -> Self {
        Self::new(20)
    }
}

/// Trims leading and trailing Unicode whitespace.
pub(crate) fn trim(text: &str) -> String {
    text.trim().to_string()
}

/// Current wall-clock time as epoch milliseconds.
pub(crate) fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::{SubtitleLine, SubtitlePair};

    #[test]
    fn opted_in_archive_outlives_overlay_history_and_excludes_drafts() {
        let mut reducer = SubtitleReducer::new(2);
        reducer.archive.begin(true, 0);
        reducer.apply(SubtitleEvent::SourceDraft("unconfirmed source".into()));
        reducer.apply(SubtitleEvent::TranslationDraft(
            "unconfirmed translation".into(),
        ));
        assert_eq!(reducer.archive.count(), 0);
        for i in 0..25 {
            reducer.apply(SubtitleEvent::FinalPair {
                source: format!("synthetic source {i}"),
                translation: format!("synthetic translation {i}"),
            });
        }
        assert_eq!(reducer.snapshot.history.len(), 2);
        assert_eq!(reducer.archive.count(), 25);
        reducer.reset_transient();
        assert_eq!(reducer.archive.count(), 25);
        reducer.apply(SubtitleEvent::Clear);
        assert_eq!(reducer.archive.count(), 0);
    }

    #[test]
    fn final_duplicates_and_empty_pairs_do_not_enter_archive() {
        let mut reducer = SubtitleReducer::default();
        reducer.archive.begin(true, 0);
        for _ in 0..2 {
            reducer.apply(SubtitleEvent::FinalPair {
                source: "synthetic".into(),
                translation: "test".into(),
            });
        }
        reducer.apply(SubtitleEvent::FinalPair {
            source: "".into(),
            translation: "test".into(),
        });
        assert_eq!(reducer.archive.count(), 1);
    }

    #[test]
    fn subtitle_reducer_starts_empty() {
        let reducer = SubtitleReducer::default();
        assert_eq!(reducer.snapshot, SubtitleSnapshot::empty());
    }

    #[test]
    fn drafts_remain_visibly_unconfirmed() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceDraft("Hello wor".into()));
        reducer.apply(SubtitleEvent::TranslationDraft("你好，世".into()));

        assert_eq!(
            reducer.snapshot.source,
            SubtitleLine::new("Hello wor", false)
        );
        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::new("你好，世", false)
        );
    }

    #[test]
    fn final_translation_creates_a_history_pair() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("Hello world.".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好，世界。".into()));

        assert_eq!(
            reducer.snapshot.source,
            SubtitleLine::new("Hello world.", true)
        );
        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::new("你好，世界。", true)
        );
        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new(
                "Hello world.".into(),
                "你好，世界。".into(),
                0
            )]
        );
    }

    #[test]
    fn an_atomic_final_pair_alone_enters_history() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("legacy pending".into()));
        reducer.apply(SubtitleEvent::FinalPair {
            source: "OpenAI source".into(),
            translation: "OpenAI translation".into(),
        });

        assert_eq!(reducer.snapshot.history.len(), 1);
        assert_eq!(reducer.snapshot.history[0].source, "OpenAI source");
        assert_eq!(
            reducer.snapshot.history[0].translation,
            "OpenAI translation"
        );
    }

    #[test]
    fn a_new_draft_keeps_confirmed_history_available() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("Hello.".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好。".into()));
        reducer.apply(SubtitleEvent::SourceDraft("How are".into()));
        reducer.apply(SubtitleEvent::TranslationDraft("你最近".into()));

        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new("Hello.".into(), "你好。".into(), 0)]
        );
        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::new("你最近", false)
        );
    }

    #[test]
    fn a_plus_final_replaces_its_preview_and_alone_enters_history() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceDraft("今日は晴れです".into()));
        reducer.apply(SubtitleEvent::TranslationDraft("今天晴天".into()));
        assert!(reducer.snapshot.history.is_empty());

        reducer.apply(SubtitleEvent::SourceFinal("今日は晴れです。".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("今天天气很好。".into()));

        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new(
                "今日は晴れです。".into(),
                "今天天气很好。".into(),
                0
            )]
        );
        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::new("今天天气很好。", true)
        );
    }

    #[test]
    fn a_late_final_translation_uses_the_recognition_line_on_screen() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("First sentence.".into()));
        reducer.apply(SubtitleEvent::SourceDraft("Second sentence".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("第一句。".into()));

        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new(
                "Second sentence".into(),
                "第一句。".into(),
                0
            )]
        );
        assert_eq!(
            reducer.snapshot.source,
            SubtitleLine::new("Second sentence", false)
        );
    }

    #[test]
    fn duplicate_finals_do_not_duplicate_history() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("Hello.".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好。".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好。".into()));
        assert_eq!(reducer.snapshot.history.len(), 1);
    }

    #[test]
    fn identical_source_and_translation_remain_in_history() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("嗯啊".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("嗯啊".into()));

        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new("嗯啊".into(), "嗯啊".into(), 0)]
        );
    }

    #[test]
    fn history_is_bounded() {
        let mut reducer = SubtitleReducer::new(2);
        for index in 1..=3 {
            reducer.apply(SubtitleEvent::SourceFinal(format!("source {index}")));
            reducer.apply(SubtitleEvent::TranslationFinal(format!(
                "translation {index}"
            )));
        }

        assert_eq!(
            reducer.snapshot.history,
            vec![
                SubtitlePair::new("source 2".into(), "translation 2".into(), 0),
                SubtitlePair::new("source 3".into(), "translation 3".into(), 0),
            ]
        );
    }

    #[test]
    fn recognition_finals_without_translations_never_enter_history() {
        let mut reducer = SubtitleReducer::new(2);
        reducer.apply(SubtitleEvent::SourceFinal("source 1".into()));
        reducer.apply(SubtitleEvent::SourceFinal("source 2".into()));
        reducer.apply(SubtitleEvent::SourceFinal("source 3".into()));

        assert!(reducer.snapshot.history.is_empty());
        assert_eq!(reducer.snapshot.source, SubtitleLine::new("source 3", true));

        reducer.apply(SubtitleEvent::TranslationFinal("late translation".into()));
        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new(
                "source 3".into(),
                "late translation".into(),
                0
            )]
        );
    }

    #[test]
    fn clear_resets_all_subtitle_state() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("Hello.".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好。".into()));
        reducer.apply(SubtitleEvent::Clear);

        assert_eq!(reducer.snapshot, SubtitleSnapshot::empty());
    }

    #[test]
    fn reconnect_clears_unconfirmed_lines_before_a_late_translation_final() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceDraft("generation A".into()));

        reducer.reset_transient();
        assert_eq!(reducer.snapshot.source, SubtitleLine::new("", false));
        reducer.apply(SubtitleEvent::TranslationFinal("译文 A".into()));
        assert!(reducer.snapshot.history.is_empty());

        reducer.apply(SubtitleEvent::SourceFinal("generation B".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("译文 B".into()));
        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new("generation B".into(), "译文 B".into(), 0)]
        );
    }

    #[test]
    fn blank_draft_does_not_overwrite_confirmed_final() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("Hello.".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好。".into()));
        reducer.apply(SubtitleEvent::TranslationDraft("   ".into()));

        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::new("你好。", true)
        );
    }

    #[test]
    fn stamped_text_keeps_one_utterance_identity_on_both_lines() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Source,
            text: "Hello.".into(),
            is_final: true,
        });
        reducer.apply(SubtitleEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Translation,
            text: "你好。".into(),
            is_final: false,
        });

        assert_eq!(
            reducer.snapshot.source.utterance_id.as_deref(),
            Some("item_source")
        );
        assert_eq!(
            reducer.snapshot.translation.utterance_id.as_deref(),
            Some("item_source")
        );
        assert!(reducer.snapshot.history.is_empty());

        reducer.apply(SubtitleEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Translation,
            text: "你好。".into(),
            is_final: true,
        });
        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new("Hello.".into(), "你好。".into(), 0)]
        );
    }

    #[test]
    fn stamped_blank_draft_does_not_overwrite_confirmed_final() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Translation,
            text: "你好。".into(),
            is_final: true,
        });
        reducer.apply(SubtitleEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Translation,
            text: "   ".into(),
            is_final: false,
        });

        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::for_utterance("你好。", true, "item_source".into())
        );
    }
}
