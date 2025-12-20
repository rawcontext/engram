"""
Tests for LiteLLM provider wrapper.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from litellm.exceptions import APIConnectionError, RateLimitError, Timeout
from pydantic import BaseModel

from engram_benchmark.providers.llm import LiteLLMProvider, LLMResponse


class SampleSchema(BaseModel):
	"""Sample schema for structured output tests."""

	answer: int
	reasoning: str


@pytest.fixture
def mock_model_response() -> MagicMock:
	"""Mock LiteLLM ModelResponse."""
	response = MagicMock()
	response.model = "anthropic/claude-sonnet-4-20250514"

	# Mock choice
	choice = MagicMock()
	message = MagicMock()
	message.content = "The answer is 42."
	choice.message = message
	response.choices = [choice]

	# Mock usage
	usage = MagicMock()
	usage.prompt_tokens = 100
	usage.completion_tokens = 50
	usage.total_tokens = 150
	response.usage = usage

	# Mock cost
	response._hidden_params = {"response_cost": 0.001}

	return response


@pytest.fixture
def mock_structured_response() -> MagicMock:
	"""Mock response with JSON content."""
	response = MagicMock()
	response.model = "anthropic/claude-sonnet-4-20250514"

	choice = MagicMock()
	message = MagicMock()
	message.content = json.dumps({"answer": 42, "reasoning": "Because 6*7=42"})
	choice.message = message
	response.choices = [choice]

	usage = MagicMock()
	usage.prompt_tokens = 100
	usage.completion_tokens = 50
	usage.total_tokens = 150
	response.usage = usage

	response._hidden_params = {"response_cost": 0.001}

	return response


@pytest.fixture
def mock_json_with_markdown_response() -> MagicMock:
	"""Mock response with JSON in markdown code block."""
	response = MagicMock()
	response.model = "anthropic/claude-sonnet-4-20250514"

	choice = MagicMock()
	message = MagicMock()
	message.content = '```json\n{"answer": 42, "reasoning": "Because 6*7=42"}\n```'
	choice.message = message
	response.choices = [choice]

	usage = MagicMock()
	usage.prompt_tokens = 100
	usage.completion_tokens = 50
	usage.total_tokens = 150
	response.usage = usage

	response._hidden_params = {"response_cost": 0.001}

	return response


class TestLiteLLMProvider:
	"""Tests for LiteLLMProvider."""

	@pytest.mark.asyncio
	async def test_generate_basic(self, mock_model_response: MagicMock) -> None:
		"""Test basic text generation."""
		with patch("engram_benchmark.providers.llm.acompletion", new_callable=AsyncMock) as mock_completion:
			mock_completion.return_value = mock_model_response

			provider = LiteLLMProvider(model="anthropic/claude-sonnet-4-20250514")
			response = await provider.generate("What is 6*7?")

			assert isinstance(response, LLMResponse)
			assert response.content == "The answer is 42."
			assert response.model == "anthropic/claude-sonnet-4-20250514"
			assert response.prompt_tokens == 100
			assert response.completion_tokens == 50
			assert response.total_tokens == 150
			assert response.cost == 0.001

			# Verify the call
			mock_completion.assert_called_once()
			call_args = mock_completion.call_args
			assert call_args.kwargs["model"] == "anthropic/claude-sonnet-4-20250514"
			assert len(call_args.kwargs["messages"]) == 1
			assert call_args.kwargs["messages"][0]["role"] == "user"
			assert "6*7" in call_args.kwargs["messages"][0]["content"]

	@pytest.mark.asyncio
	async def test_generate_with_system_prompt(self, mock_model_response: MagicMock) -> None:
		"""Test generation with system prompt."""
		with patch("engram_benchmark.providers.llm.acompletion", new_callable=AsyncMock) as mock_completion:
			mock_completion.return_value = mock_model_response

			provider = LiteLLMProvider(model="anthropic/claude-sonnet-4-20250514")
			response = await provider.generate(
				"What is 6*7?",
				system_prompt="You are a helpful math tutor."
			)

			assert response.content == "The answer is 42."

			# Verify system prompt was included
			call_args = mock_completion.call_args
			messages = call_args.kwargs["messages"]
			assert len(messages) == 2
			assert messages[0]["role"] == "system"
			assert messages[0]["content"] == "You are a helpful math tutor."
			assert messages[1]["role"] == "user"

	@pytest.mark.asyncio
	async def test_generate_structured(self, mock_structured_response: MagicMock) -> None:
		"""Test structured output generation."""
		with patch("engram_benchmark.providers.llm.acompletion", new_callable=AsyncMock) as mock_completion:
			mock_completion.return_value = mock_structured_response

			provider = LiteLLMProvider(model="anthropic/claude-sonnet-4-20250514")
			result = await provider.generate_structured(
				"What is 6*7? Respond in JSON.",
				schema=SampleSchema
			)

			assert isinstance(result, SampleSchema)
			assert result.answer == 42
			assert result.reasoning == "Because 6*7=42"

	@pytest.mark.asyncio
	async def test_generate_structured_with_markdown(
		self,
		mock_json_with_markdown_response: MagicMock
	) -> None:
		"""Test structured output with markdown code blocks."""
		with patch("engram_benchmark.providers.llm.acompletion", new_callable=AsyncMock) as mock_completion:
			mock_completion.return_value = mock_json_with_markdown_response

			provider = LiteLLMProvider(model="anthropic/claude-sonnet-4-20250514")
			result = await provider.generate_structured(
				"What is 6*7?",
				schema=SampleSchema
			)

			assert isinstance(result, SampleSchema)
			assert result.answer == 42
			assert result.reasoning == "Because 6*7=42"

	@pytest.mark.asyncio
	async def test_generate_structured_enhances_prompt(
		self,
		mock_structured_response: MagicMock
	) -> None:
		"""Test that structured generation enhances prompt with schema."""
		with patch("engram_benchmark.providers.llm.acompletion", new_callable=AsyncMock) as mock_completion:
			mock_completion.return_value = mock_structured_response

			provider = LiteLLMProvider(model="anthropic/claude-sonnet-4-20250514")
			await provider.generate_structured(
				"What is 6*7?",
				schema=SampleSchema
			)

			# Verify prompt was enhanced with schema
			call_args = mock_completion.call_args
			messages = call_args.kwargs["messages"]
			user_message = messages[-1]["content"]
			assert "json" in user_message.lower()
			assert "schema" in user_message.lower()

	@pytest.mark.asyncio
	async def test_generate_structured_invalid_json(
		self,
		mock_model_response: MagicMock
	) -> None:
		"""Test structured generation with invalid JSON."""
		with patch("engram_benchmark.providers.llm.acompletion", new_callable=AsyncMock) as mock_completion:
			mock_completion.return_value = mock_model_response

			provider = LiteLLMProvider(model="anthropic/claude-sonnet-4-20250514")

			with pytest.raises(ValueError, match="Failed to parse JSON"):
				await provider.generate_structured(
					"What is 6*7?",
					schema=SampleSchema
				)

	@pytest.mark.asyncio
	async def test_retry_on_rate_limit(self, mock_model_response: MagicMock) -> None:
		"""Test retry logic on rate limit errors."""
		with patch("engram_benchmark.providers.llm.acompletion", new_callable=AsyncMock) as mock_completion:
			# First call raises RateLimitError, second succeeds
			mock_completion.side_effect = [
				RateLimitError("Rate limited", model="test", llm_provider="test"),
				mock_model_response
			]

			provider = LiteLLMProvider(
				model="anthropic/claude-sonnet-4-20250514",
				retry_delay=0.01  # Short delay for testing
			)
			response = await provider.generate("Test")

			assert response.content == "The answer is 42."
			assert mock_completion.call_count == 2

	@pytest.mark.asyncio
	async def test_retry_on_connection_error(self, mock_model_response: MagicMock) -> None:
		"""Test retry logic on connection errors."""
		with patch("engram_benchmark.providers.llm.acompletion", new_callable=AsyncMock) as mock_completion:
			# First call raises APIConnectionError, second succeeds
			mock_completion.side_effect = [
				APIConnectionError(request=MagicMock()),
				mock_model_response
			]

			provider = LiteLLMProvider(
				model="anthropic/claude-sonnet-4-20250514",
				retry_delay=0.01
			)
			response = await provider.generate("Test")

			assert response.content == "The answer is 42."
			assert mock_completion.call_count == 2

	@pytest.mark.asyncio
	async def test_retry_on_timeout(self, mock_model_response: MagicMock) -> None:
		"""Test retry logic on timeout errors."""
		with patch("engram_benchmark.providers.llm.acompletion", new_callable=AsyncMock) as mock_completion:
			# First call raises Timeout, second succeeds
			mock_completion.side_effect = [
				Timeout("Timeout"),
				mock_model_response
			]

			provider = LiteLLMProvider(
				model="anthropic/claude-sonnet-4-20250514",
				retry_delay=0.01
			)
			response = await provider.generate("Test")

			assert response.content == "The answer is 42."
			assert mock_completion.call_count == 2

	@pytest.mark.asyncio
	async def test_retry_exhausted(self) -> None:
		"""Test that retries are exhausted after max attempts."""
		with patch("engram_benchmark.providers.llm.acompletion", new_callable=AsyncMock) as mock_completion:
			# Always raise RateLimitError
			mock_completion.side_effect = RateLimitError(
				"Rate limited",
				model="test",
				llm_provider="test"
			)

			provider = LiteLLMProvider(
				model="anthropic/claude-sonnet-4-20250514",
				max_retries=2,
				retry_delay=0.01
			)

			with pytest.raises(RateLimitError):
				await provider.generate("Test")

			assert mock_completion.call_count == 2

	@pytest.mark.asyncio
	async def test_custom_parameters(self, mock_model_response: MagicMock) -> None:
		"""Test custom generation parameters."""
		with patch("engram_benchmark.providers.llm.acompletion", new_callable=AsyncMock) as mock_completion:
			mock_completion.return_value = mock_model_response

			provider = LiteLLMProvider(
				model="anthropic/claude-sonnet-4-20250514",
				max_tokens=2048,
				temperature=0.7
			)
			await provider.generate("Test")

			call_args = mock_completion.call_args
			assert call_args.kwargs["max_tokens"] == 2048
			assert call_args.kwargs["temperature"] == 0.7
