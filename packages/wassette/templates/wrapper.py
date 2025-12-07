import sys
import json
import traceback

# Import user module (assumed to be mapped to /app/main.py or similar)
try:
    from main import tool_function
except ImportError:
    # If no main.py, maybe it's a script execution.
    # We assume the entry point is defined.
    pass

if __name__ == "__main__":
    try:
        # Read args from stdin
        input_str = sys.stdin.read()
        args = json.loads(input_str) if input_str.strip() else {}
        
        # Execute
        if 'tool_function' in locals():
            result = tool_function(**args)
            print(json.dumps({"status": "success", "result": result}))
        else:
            print(json.dumps({"status": "error", "error": "tool_function not found in main.py"}))
            
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"status": "error", "error": str(e)}))
