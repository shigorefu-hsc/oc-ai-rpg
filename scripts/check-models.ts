import { BedrockAI } from '../server/bedrock';
import { config } from '../server/config';
import { initialWork, outputSchema, ModelKey, MODELS } from '../shared/domain';
const ai = new BedrockAI(config().modelIds);
for (const model of ['nova', 'haiku'] as ModelKey[]) {
  const work = initialWork(
    crypto.randomUUID(),
    'deployment-check',
    'Model smoke test',
    model,
    Date.now(),
  );
  const input = {
    requestId: crypto.randomUUID(),
    target: 'seller',
    mode: 'edit' as const,
    text: '臆病だけどやさしい商人にして。人が近づくと距離をとる。',
  };
  console.log('Checking ' + model + '...');
  const p = ai.prepare(work, input, []);
  const result = await ai.generate(p, AbortSignal.timeout(240000), () => {});
  const out = outputSchema('seller', 'edit').parse(
    JSON.parse(result.raw.replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/g, '')),
  );
  const behavior = (out.update as { behavior?: string } | null)?.behavior;
  if (behavior !== 'avoid') throw new Error('Expected avoid behavior');
  console.log(
    JSON.stringify({
      model,
      modelId: result.modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      stop: result.stopReason,
      behavior,
      estimatedUSD:
        (result.inputTokens * MODELS[model].inputRate +
          result.outputTokens * MODELS[model].outputRate) /
        1000000,
    }),
  );
}
