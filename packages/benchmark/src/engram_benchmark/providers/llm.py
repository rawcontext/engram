"""
LiteLLM provider wrapper for unified LLM access.

Provides:
- Unified interface for 100+ LLM providers via LiteLLM
- Automatic retries with exponential backoff
- Structured output parsing with Pydantic
- Cost and token tracking
- Error handling and logging

Supported providers (examples):
- anthropic/claude-sonnet-4-20250514
- openai/gpt-4o
- gemini/gemini-2.0-flash-exp
- ollama/qwen2.5:32b
"""

import asyncio
import json
from typing import Any, TypeVar, cast

from litellm import acompletion
from litellm.exceptions import (
    APIConnectionError,
    APIError,
    RateLimitError,
    Timeout,
)
from litellm.types.utils import ModelResponse
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMResponse(BaseModel):
    """Response from LLM generation."""

    content: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost: float | None = None


class LiteLLMProvider:
    """
    LiteLLM wrapper with retry logic and structured outputs.

    Examples:
        Basic usage:
        >>> provider = LiteLLMProvider(model="anthropic/claude-sonnet-4-20250514")
        >>> response = await provider.generate("What is 2+2?")
        >>> print(response.content)

        Structured output:
        >>> class Answer(BaseModel):
        ...     value: int
        ...     reasoning: str
        >>> answer = await provider.generate_structured(
        ...     "What is 2+2? Respond in JSON.",
        ...     schema=Answer
        ... )
        >>> print(answer.value)  # 4
    """

    def __init__(
        self,
        model: str,
        max_tokens: int = 1024,
        temperature: float = 0.0,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        timeout: float = 60.0,
    ) -> None:
        """
        Initialize LiteLLM provider.

        Args:
            model: Model identifier in LiteLLM format (e.g., "anthropic/claude-sonnet-4-20250514")
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature (0.0 = deterministic)
            max_retries: Maximum number of retry attempts
            retry_delay: Initial retry delay in seconds (exponential backoff)
            timeout: Request timeout in seconds
        """
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.timeout = timeout

    async def generate(
        self,
        prompt: str,
        system_prompt: str | None = None,
        **kwargs: Any,
    ) -> LLMResponse:
        """
        Generate text completion from a prompt.

        Args:
            prompt: User prompt
            system_prompt: Optional system prompt
            **kwargs: Additional arguments passed to LiteLLM

        Returns:
            LLMResponse with generated text and metadata

        Raises:
            APIError: On API errors after retries exhausted
            Timeout: On timeout after retries exhausted
        """
        messages: list[dict[str, str]] = []

        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        messages.append({"role": "user", "content": prompt})

        response = await self._call_with_retry(messages, **kwargs)

        return self._parse_response(response)

    async def generate_structured(
        self,
        prompt: str,
        schema: type[T],
        system_prompt: str | None = None,
        **kwargs: Any,
    ) -> T:
        """
        Generate structured output conforming to a Pydantic schema.

        Args:
            prompt: User prompt (should instruct model to return JSON)
            schema: Pydantic model class to parse response into
            system_prompt: Optional system prompt
            **kwargs: Additional arguments passed to LiteLLM

        Returns:
            Parsed Pydantic model instance

        Raises:
            ValueError: If response cannot be parsed as JSON or doesn't match schema
            APIError: On API errors after retries exhausted
        """
        # Add JSON instruction to prompt if not already present
        if "json" not in prompt.lower():
            enhanced_prompt = f"{prompt}\n\nRespond with valid JSON matching this schema:\n{schema.model_json_schema()}"
        else:
            enhanced_prompt = prompt

        response = await self.generate(enhanced_prompt, system_prompt, **kwargs)

        # Extract JSON from response (handles markdown code blocks)
        content = response.content.strip()

        # Remove markdown code fences if present
        if content.startswith("```"):
            # Find first newline after opening fence
            first_newline = content.find("\n")
            # Find closing fence
            last_fence = content.rfind("```")
            if first_newline != -1 and last_fence > first_newline:
                content = content[first_newline + 1 : last_fence].strip()

        # Parse JSON and validate against schema
        try:
            data = json.loads(content)
            return schema.model_validate(data)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse JSON response: {e}\nContent: {content}") from e
        except Exception as e:
            raise ValueError(f"Failed to validate against schema: {e}\nData: {content}") from e

    async def _call_with_retry(
        self,
        messages: list[dict[str, str]],
        **kwargs: Any,
    ) -> ModelResponse:
        """
        Call LiteLLM with exponential backoff retry logic.

        Args:
            messages: List of message dictionaries
            **kwargs: Additional arguments passed to LiteLLM

        Returns:
            ModelResponse from LiteLLM

        Raises:
            APIError: On API errors after retries exhausted
            Timeout: On timeout after retries exhausted
        """
        last_error: Exception | None = None

        for attempt in range(self.max_retries):
            try:
                response = await acompletion(
                    model=self.model,
                    messages=messages,
                    max_tokens=self.max_tokens,
                    temperature=self.temperature,
                    timeout=self.timeout,
                    **kwargs,
                )
                # LiteLLM returns ModelResponse but typing is complex, so we cast
                return cast("ModelResponse", response)

            except (RateLimitError, APIConnectionError, Timeout) as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    # Exponential backoff
                    delay = self.retry_delay * (2**attempt)
                    await asyncio.sleep(delay)
                    continue
                raise

            except APIError:
                # Don't retry on client errors (4xx)
                raise

        # Should not reach here, but just in case
        if last_error:
            raise last_error
        raise RuntimeError("Unexpected error in retry logic")

    def _parse_response(self, response: ModelResponse) -> LLMResponse:
        """
        Parse LiteLLM ModelResponse into LLMResponse.

        Args:
            response: Raw response from LiteLLM

        Returns:
            Parsed LLMResponse with token counts and cost
        """
        # LiteLLM's typing is complex, so we access attributes dynamically
        choice = response.choices[0]
        content = getattr(getattr(choice, "message", None), "content", "") or ""

        usage = getattr(response, "usage", None)
        prompt_tokens = getattr(usage, "prompt_tokens", 0) if usage else 0
        completion_tokens = getattr(usage, "completion_tokens", 0) if usage else 0
        total_tokens = getattr(usage, "total_tokens", 0) if usage else 0

        # LiteLLM provides cost tracking in response metadata
        cost = getattr(response, "_hidden_params", {}).get("response_cost")

        return LLMResponse(
            content=content,
            model=getattr(response, "model", None) or self.model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost=cost,
        )
