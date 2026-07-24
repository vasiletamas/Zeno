/**
 * Moonshot AI (Kimi) Provider Implementation
 *
 * Moonshot AI's API is OpenAI-compatible — same /v1/chat/completions dialect,
 * same request/response shapes, same streaming and tool-calling semantics — so
 * this provider is a thin configuration of the shared OpenAIProvider, pointed
 * at Moonshot's base URL and authenticated with MOONSHOT_API_KEY.
 *
 * This is the third first-class vendor, alongside OpenAI and Anthropic. It
 * serves the Kimi model family (e.g. kimi-k2 / moonshot-v1-*). Because the
 * OpenAI-specific quirks in the base class key off `gpt-*`/`o*` model
 * prefixes, a Kimi model id sidesteps them and receives plain max_tokens +
 * temperature, which is what Moonshot expects.
 *
 * Docs: https://platform.moonshot.ai/docs/api/chat
 */

import { OpenAIProvider } from './openai'

/**
 * Moonshot's OpenAI-compatible base URL. The global endpoint is
 * api.moonshot.ai; the mainland-China endpoint is api.moonshot.cn. Override
 * with MOONSHOT_BASE_URL to switch regions or route through a gateway. Must
 * include the version path — the SDK appends '/chat/completions'.
 */
const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1'

export class MoonshotProvider extends OpenAIProvider {
  constructor() {
    super({
      providerName: 'MOONSHOT',
      apiKeyEnvVar: 'MOONSHOT_API_KEY',
      baseURL: process.env.MOONSHOT_BASE_URL || DEFAULT_MOONSHOT_BASE_URL,
    })
  }
}
