"""Unified LLM chat interface routing to Anthropic or Gemini by model name prefix."""


def chat(model: str, prompt: str, max_tokens: int, config: dict) -> str:
    if model.startswith("gemini"):
        return _gemini(model, prompt, max_tokens, config.get("GEMINI_API_KEY", ""))
    return _anthropic(model, prompt, max_tokens, config.get("ANTHROPIC_API_KEY", ""))


def _anthropic(model: str, prompt: str, max_tokens: int, api_key: str) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


def _gemini(model: str, prompt: str, max_tokens: int, api_key: str) -> str:
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    m = genai.GenerativeModel(
        model,
        generation_config=genai.GenerationConfig(max_output_tokens=max_tokens),
    )
    resp = m.generate_content(prompt)
    return resp.text


def active_api_key(config: dict) -> bool:
    """Return True if at least one LLM API key is configured."""
    return bool(config.get("ANTHROPIC_API_KEY") or config.get("GEMINI_API_KEY"))


def default_models(config: dict) -> tuple[str, str]:
    """Return (ranking_model, rewrite_model) based on which API key is set."""
    if config.get("ANTHROPIC_API_KEY"):
        return config["RANKING_MODEL"], config["REWRITE_MODEL"]
    if config.get("GEMINI_API_KEY"):
        return (
            config.get("GEMINI_RANKING_MODEL", "gemini-1.5-flash"),
            config.get("GEMINI_REWRITE_MODEL", "gemini-1.5-pro"),
        )
    return config["RANKING_MODEL"], config["REWRITE_MODEL"]
