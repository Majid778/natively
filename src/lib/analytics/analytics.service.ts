export type ModelProviderType = 'cloud' | 'local';
export type AssistantMode = 'launcher' | 'overlay' | 'undetectable' | string;

interface ModelUsedPayload {
  model_name: string;
  provider_type: ModelProviderType;
  latency_ms: number;
  tokens_used?: number;
}

/** Detect if a model is running locally or through a cloud provider. */
export function detectProviderType(modelName: string): ModelProviderType {
  const lower = modelName.toLowerCase();
  if (
    lower.startsWith('local:') ||
    lower.includes('llama') ||
    lower.includes('mistral') ||
    lower.includes('codellama') ||
    lower.includes('phi') ||
    lower.includes('qwen') ||
    lower.includes('vicuna') ||
    lower.includes('orca')
  ) {
    return 'local';
  }
  return 'cloud';
}

class AnalyticsService {
  public initAnalytics(): void {}
  public trackAppOpen(): void {}
  public trackAppClose(): void {}
  public trackAssistantStart(): void {}
  public trackAssistantStop(): void {}
  public trackModeSelected(_mode: AssistantMode): void {}
  public trackModelUsed(_payload: ModelUsedPayload): void {}
  public trackCopyAnswer(): void {}
  public trackCommandExecuted(_commandType: string): void {}
  public trackConversationStarted(): void {}
  public trackCalendarConnected(): void {}
  public trackMeetingStarted(): void {}
  public trackMeetingEnded(): void {}
  public trackPdfExported(): void {}
}

export const analytics = new AnalyticsService();
