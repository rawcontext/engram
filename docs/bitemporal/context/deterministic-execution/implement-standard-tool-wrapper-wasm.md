# Bead: Implement Standard Tool Wrapper (Wasm)

## Context
Tools (e.g., `calculate_fibonacci`) are executed as scripts inside the Wasm container.

## Goal
Create a standard wrapper script (Python/JS) that:
1.  Reads arguments from `stdin` or a file.
2.  Executes the target function.
3.  Prints result to `stdout` as JSON.

## Wrapper (Python Example)
```python
import sys
import json
# Import user module
from main import tool_function

if __name__ == "__main__":
    args = json.load(sys.stdin)
    try:
        result = tool_function(**args)
        print(json.dumps({"status": "success", "result": result}))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
```

## Acceptance Criteria
-   [ ] Wrapper templates created for Python and TypeScript/JS.
-   [ ] `ToolExecutor` class injects this wrapper into the VFS before execution.
