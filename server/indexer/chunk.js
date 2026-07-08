// Troceado en fragmentos de ~512 tokens con solapamiento de 64 (RF-03.5).
//
// e5-small no expone aquí su tokenizador durante el troceado, así que estimamos tokens a
// partir de palabras con un factor conservador. El objetivo se mantiene por debajo del
// límite de 512 tokens del modelo (incluyendo el prefijo "passage: " y tokens especiales).
//
// Los chunks NO cruzan fronteras de página: así el nº de página del metadato es exacto.

const TOKENS_PER_WORD = 1.4; // conservador para español + tokenizador XLM-Roberta

function wordsFromTokens(tokens) {
  return Math.max(1, Math.floor(tokens / TOKENS_PER_WORD));
}

// Divide un bloque de texto (una página) en ventanas deslizantes de palabras.
function windowWords(words, targetWords, overlapWords) {
  const step = Math.max(1, targetWords - overlapWords);
  const windows = [];
  for (let start = 0; start < words.length; start += step) {
    const slice = words.slice(start, start + targetWords);
    if (slice.length === 0) break;
    windows.push(slice.join(' '));
    if (start + targetWords >= words.length) break;
  }
  return windows;
}

// pages: [{ page: number|null, text: string }] → [{ chunkId, text, page }]
export function chunkPages(pages, { chunkSizeTokens = 512, chunkOverlapTokens = 64 } = {}) {
  const targetWords = wordsFromTokens(chunkSizeTokens);
  const overlapWords = Math.min(wordsFromTokens(chunkOverlapTokens), targetWords - 1);

  const chunks = [];
  let chunkId = 0;
  for (const { page, text } of pages) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    for (const windowText of windowWords(words, targetWords, overlapWords)) {
      chunks.push({ chunkId: chunkId++, text: windowText, page });
    }
  }
  return chunks;
}

export default { chunkPages };
