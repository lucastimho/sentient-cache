import type { Embedder } from "./Embedder";

type Pipeline = (input: string | string[], opts?: unknown) => Promise<{ data: Float32Array }>;

// Wraps `@xenova/transformers` on demand. The dep is not declared in package.json
// because it adds ~50MB — the consumer installs it when they want real embeddings.
export class TransformersEmbedder implements Embedder {
  readonly dimensions: number;
  private readonly modelName: string;
  private pipelinePromise: Promise<Pipeline> | null = null;

  constructor(modelName = "Xenova/all-MiniLM-L6-v2", dimensions = 384) {
    this.modelName = modelName;
    this.dimensions = dimensions;
  }

  private async getPipeline(): Promise<Pipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const mod = (await import(/* @vite-ignore */ "@xenova/transformers" as string).catch(
          () => {
            throw new Error(
              "TransformersEmbedder requires '@xenova/transformers' — install it or swap to HashEmbedder",
            );
          },
        )) as { pipeline: (task: string, model: string) => Promise<Pipeline> };
        return mod.pipeline("feature-extraction", this.modelName);
      })();
    }
    return this.pipelinePromise;
  }

  async embed(text: string): Promise<Float32Array> {
    const pipe = await this.getPipeline();
    const out = await pipe(text, { pooling: "mean", normalize: true });
    return new Float32Array(out.data);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const pipe = await this.getPipeline();
    const results: Float32Array[] = [];
    for (const t of texts) {
      const out = await pipe(t, { pooling: "mean", normalize: true });
      results.push(new Float32Array(out.data));
    }
    return results;
  }
}
