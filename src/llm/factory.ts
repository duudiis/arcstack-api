import { BaseProvider, type ProviderConfig } from "./providers/base.js";
import { OpenAIProvider } from "./providers/openai.js";

type ProviderConstructor = new (config: ProviderConfig) => BaseProvider;

class AIFactoryClass {
  private providers = new Map<string, ProviderConstructor>();
  private instances = new Map<string, BaseProvider>();

  register(name: string, provider: ProviderConstructor) {
    this.providers.set(name, provider);
  }

  create(name: string, config: ProviderConfig): BaseProvider {
    const existing = this.instances.get(name);
    if (existing) return existing;

    const Provider = this.providers.get(name);
    if (!Provider) {
      throw new Error(`Unknown LLM provider: ${name}. Available: ${[...this.providers.keys()].join(", ")}`);
    }

    const instance = new Provider(config);
    this.instances.set(name, instance);
    return instance;
  }

  getAvailableProviders(): string[] {
    return [...this.providers.keys()];
  }
}

export const AIFactory = new AIFactoryClass();

AIFactory.register("openai", OpenAIProvider);
