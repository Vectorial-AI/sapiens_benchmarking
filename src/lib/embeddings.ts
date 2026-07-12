import { hasGatewayKey } from "./ai";

const EMBEDDING_MODEL = "text-embedding-3-small";

function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!denom) return 1;
  return 1 - dot / denom;
}

/** Lexical fallback when embeddings are unavailable (mock / no API key). */
function lexicalTextDelta(a: string, b: string): number {
  const tokenize = (text: string) =>
    new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []));
  const wa = tokenize(a);
  const wb = tokenize(b);
  if (!wa.size || !wb.size) return 1;
  let hits = 0;
  wa.forEach((w) => {
    if (wb.has(w)) hits++;
  });
  const precision = hits / wa.size;
  const recall = hits / wb.size;
  const f1 =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return Math.max(0, Math.min(1, 1 - f1));
}

async function fetchEmbeddings(texts: string[]): Promise<number[][]> {
  const key =
    process.env.OPENAI_EMBEDDINGS_API_KEY ||
    process.env.OPENAI_DIRECT_API_KEY ||
    process.env.AI_GATEWAY_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.VERCEL_OIDC_TOKEN;
  if (!key) throw new Error("No embedding API key");

  const baseUrl = process.env.AI_GATEWAY_API_KEY
    ? "https://ai-gateway.vercel.sh/v1"
    : (
        process.env.OPENAI_EMBEDDINGS_BASE_URL ||
        "https://api.openai.com/v1"
      ).replace(/\/$/, "");

  const model = process.env.AI_GATEWAY_API_KEY
    ? `openai/${EMBEDDING_MODEL}`
    : EMBEDDING_MODEL;

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: texts,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embeddings failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    data?: { embedding: number[]; index: number }[];
  };
  const rows = data.data ?? [];
  rows.sort((x, y) => x.index - y.index);
  return rows.map((r) => r.embedding);
}

/**
 * text_delta = cosine distance between review-text embeddings.
 * Falls back to lexical overlap when no API key (mock mode).
 */
export async function computeTextDelta(
  predictedText: string,
  groundTruthText: string,
): Promise<number> {
  const pred = predictedText.trim();
  const gt = groundTruthText.trim();
  if (!pred || !gt) return 1;

  if (!hasGatewayKey() && !process.env.OPENAI_API_KEY) {
    return lexicalTextDelta(pred, gt);
  }

  try {
    const [predEmb, gtEmb] = await fetchEmbeddings([pred, gt]);
    return cosineDistance(predEmb, gtEmb);
  } catch {
    return lexicalTextDelta(pred, gt);
  }
}
