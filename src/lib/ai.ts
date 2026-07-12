function openAiBaseUrl(): string {
  if (process.env.AI_GATEWAY_API_KEY) {
    return "https://ai-gateway.vercel.sh/v1";
  }
  return (
    process.env.OPENAI_BASE_URL ||
    process.env.AZURE_OPENAI_ENDPOINT ||
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");
}

function deploymentName(model: string): string {
  const name = model.replace(/^openai\//, "");
  if (name === "gpt-4o-mini") return "gpt-5-mini";
  return name;
}

export const hasGatewayKey = () =>
  Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);

export async function runModel(args: {
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
}): Promise<string> {
  if (hasGatewayKey()) {
    const { generateText } = await import("ai");
    const { text } = await generateText({
      model: args.model,
      system: args.system,
      prompt: args.prompt,
      temperature: args.temperature ?? 0.8,
    });
    return text;
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = deploymentName(args.model);
  const isReasoning = /^(o[134]|gpt-5)/i.test(model);
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.prompt },
    ],
  };
  if (isReasoning) {
    body.max_completion_tokens = 2500;
  } else {
    body.max_tokens = 2500;
    body.temperature = args.temperature ?? 0.8;
  }

  const res = await fetch(`${openAiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Chat completion failed (${res.status}): ${err.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() || "";
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
