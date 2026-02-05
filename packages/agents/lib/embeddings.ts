import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMENSION = parseInt(
  process.env.EMBEDDING_DIMENSION || "1536",
);

export interface EmbeddingResult {
  embedding: number[];
  dimension: number;
}

export async function generateEmbedding(
  text: string,
  model: string = DEFAULT_EMBEDDING_MODEL,
): Promise<EmbeddingResult> {
  const response = await openai.embeddings.create({
    model,
    input: text,
    dimensions: DEFAULT_EMBEDDING_DIMENSION,
  });

  return {
    embedding: response.data[0].embedding,
    dimension: response.data[0].embedding.length,
  };
}

export async function generateEmbeddings(
  texts: string[],
  model: string = DEFAULT_EMBEDDING_MODEL,
): Promise<EmbeddingResult[]> {
  const response = await openai.embeddings.create({
    model,
    input: texts,
    dimensions: DEFAULT_EMBEDDING_DIMENSION,
  });

  return response.data.map((item) => ({
    embedding: item.embedding,
    dimension: item.embedding.length,
  }));
}
