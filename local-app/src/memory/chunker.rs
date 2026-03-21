//! 文档分块器
//!
//! 将长文档拆分为有重叠的小块，提高向量嵌入质量。
//! 参考 IronClaw 的 chunker.rs：默认 800 词，15% 重叠。

/// 分块配置
#[derive(Debug, Clone)]
pub struct ChunkConfig {
    /// 每块最大词数
    pub max_words: usize,
    /// 重叠比例（0.0 ~ 0.5）
    pub overlap_ratio: f64,
    /// 最小块词数（太短的块不保留）
    pub min_words: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            max_words: 800,
            overlap_ratio: 0.15,
            min_words: 50,
        }
    }
}

/// 分块结果
#[derive(Debug, Clone)]
pub struct Chunk {
    /// 块内容
    pub content: String,
    /// 在原文档中的起始词索引
    pub start_word: usize,
    /// 块的词数
    pub word_count: usize,
}

/// 将文本分块。短文档（< max_words）直接返回一整块。
pub fn chunk_text(text: &str, config: &ChunkConfig) -> Vec<Chunk> {
    let words: Vec<&str> = text.split_whitespace().collect();

    if words.len() <= config.max_words {
        if words.len() < config.min_words {
            return Vec::new(); // 太短，不值得索引
        }
        return vec![Chunk {
            content: text.to_string(),
            start_word: 0,
            word_count: words.len(),
        }];
    }

    let overlap_words = (config.max_words as f64 * config.overlap_ratio) as usize;
    let step = config.max_words.saturating_sub(overlap_words).max(1);

    let mut chunks = Vec::new();
    let mut start = 0;

    while start < words.len() {
        let end = (start + config.max_words).min(words.len());
        let chunk_words = &words[start..end];

        // 尝试在句子边界切割（往回找句号、换行）
        let actual_end = if end < words.len() {
            find_sentence_boundary(chunk_words, config.max_words)
                .map(|b| start + b)
                .unwrap_or(end)
        } else {
            end
        };

        let chunk_content = words[start..actual_end].join(" ");
        let word_count = actual_end - start;

        if word_count >= config.min_words {
            chunks.push(Chunk {
                content: chunk_content,
                start_word: start,
                word_count,
            });
        }

        start += step;
    }

    chunks
}

/// 在块的词列表中找句子边界（句号/换行后的位置）
fn find_sentence_boundary(words: &[&str], max_words: usize) -> Option<usize> {
    // 从 max_words 的 80% 位置开始往后找
    let search_start = (max_words * 4 / 5).min(words.len());
    for i in (search_start..words.len()).rev() {
        let w = words[i];
        if w.ends_with('.') || w.ends_with('。') || w.ends_with('\n')
            || w.ends_with('!') || w.ends_with('！')
            || w.ends_with('?') || w.ends_with('？')
        {
            return Some(i + 1);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_short_text_single_chunk() {
        let text = "Hello world this is a test sentence.";
        let chunks = chunk_text(text, &ChunkConfig { min_words: 1, ..Default::default() });
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].content, text);
    }

    #[test]
    fn test_too_short_text_empty() {
        let text = "Hello world";
        let chunks = chunk_text(text, &ChunkConfig::default()); // min_words=50
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_long_text_multiple_chunks() {
        let text = (0..1000).map(|i| format!("word{}", i)).collect::<Vec<_>>().join(" ");
        let config = ChunkConfig { max_words: 100, overlap_ratio: 0.15, min_words: 10 };
        let chunks = chunk_text(&text, &config);
        assert!(chunks.len() > 1);
        // 每块不超过 max_words
        for chunk in &chunks {
            assert!(chunk.word_count <= 100);
        }
    }

    #[test]
    fn test_overlap_exists() {
        let text = (0..200).map(|i| format!("w{}", i)).collect::<Vec<_>>().join(" ");
        let config = ChunkConfig { max_words: 100, overlap_ratio: 0.15, min_words: 10 };
        let chunks = chunk_text(&text, &config);
        assert!(chunks.len() >= 2);
        // 第二块的起始应该 < 第一块的结束（有重叠）
        assert!(chunks[1].start_word < chunks[0].start_word + chunks[0].word_count);
    }
}
