import { generateText } from "ai";

export const hasGatewayKey = () =>
  Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);

export async function runModel(args: {
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
}): Promise<string> {
  const { text } = await generateText({
    model: args.model,
    system: args.system,
    prompt: args.prompt,
    temperature: args.temperature ?? 0.8,
  });
  return text;
}

/** Offline mock predictions so the app is fully demoable without a gateway key. */
export function mockPrediction(
  engine: "baseline" | "sapiens",
  productDescription: string,
  baselineKind?: string,
): {
  reviewText: string;
  predictedThemes: Record<string, number>;
  sentiment: "Positive" | "Negative" | "Neutral";
} {
  const themes: Record<string, number> = {
    "Effectiveness & Precision": engine === "sapiens" ? 0.82 : 0.65,
    "Ease of Use & Convenience": 0.55,
    "Value for Money": 0.48,
    "Quality & Durability": 0.6,
    "Safety & Health Considerations": engine === "sapiens" ? 0.71 : 0.4,
  };
  return {
    reviewText: mockReview(engine, productDescription, baselineKind),
    predictedThemes: themes,
    sentiment: baselineKind === "history" ? "Positive" : "Neutral",
  };
}

/** Offline mock reviews so the app is fully demoable without a gateway key. */
export function mockReview(
  engine: "baseline" | "sapiens",
  productDescription: string,
  baselineKind?: string,
): string {
  const p = productDescription.split(/[.,\n]/)[0].slice(0, 60);
  if (engine === "sapiens") {
    return `Bought the ${p} and put it through the one test that actually matters for how I shop. It arrived sealed and complete, so no first-use surprises. The core thing it promises held up on the first honest try — I didn't have to invent a workaround. There's a small trade-off I'd flag for anyone with my setup, but it doesn't break the job it's for. If the one gate you care about is the same as mine, it earns the buy; otherwise look elsewhere.`;
  }
  if (baselineKind === "history") {
    return `Picked up the ${p} and it slots into my routine about like my other buys. Decent build, does what it says, and the value feels fair for what you get. A couple of small nitpicks but nothing that would stop me recommending it to someone in the same boat. Solid, no regrets so far.`;
  }
  return `The ${p} seems well made and works as described. Good features and a reasonable price. There are a few minor things that could be better, but overall it's a solid choice for most people looking in this category.`;
}
