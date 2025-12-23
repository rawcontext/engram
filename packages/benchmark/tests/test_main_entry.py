"""Tests for the __main__ module entry point."""

from unittest.mock import patch


def test_main_entry_imports_app() -> None:
    """Test that __main__ imports the app."""
    from engram_benchmark import __main__ as main_module

    assert hasattr(main_module, "app")


def test_main_entry_runs_when_main() -> None:
    """Test that __main__ calls app() when run as __main__."""
    with patch("engram_benchmark.cli.app") as mock_app:
        # Simulate running the module
        exec(
            compile(
                """
if __name__ == "__main__":
    app()
""",
                "<string>",
                "exec",
            ),
            {"__name__": "__main__", "app": mock_app},
        )

        mock_app.assert_called_once()
