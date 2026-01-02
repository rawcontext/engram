# Engram Workflow Formulas

Reusable workflow templates for Gastown multi-agent orchestration.

## Available Formulas

| Formula | Purpose | Steps |
|---------|---------|-------|
| `implement-feature` | Full feature implementation | research → plan → implement → test → lint → commit |
| `fix-bug` | Bug investigation and fix | reproduce → diagnose → fix → verify → commit |
| `add-tests` | Test writing | analyze → design → implement → verify → commit |
| `research-task` | Research and exploration | context → explore → external → synthesize → document |
| `refactor-module` | Safe refactoring | analyze → plan → tests → refactor → verify → commit |
| `parallel-beads` | Batch parallel execution | identify → convoy → dispatch → monitor → merge |

## Usage

### Single Agent (Manual)

```bash
# Cook formula into protomolecule
bd cook implement-feature

# Pour into executable molecule for a specific bead
gt mol pour implement-feature engram-abc123

# Execute steps
bd close engram-abc123.1 --continue  # Advances to next step
```

### Multi-Agent (Convoy)

```bash
# Bundle beads into convoy
gt convoy create "semantic-layer" engram-i05bi engram-mefkc engram-qmecl

# Dispatch to agents
gt sling engram-i05bi worker-1
gt sling engram-mefkc worker-2
gt sling engram-qmecl worker-3

# Or spawn polecat swarm
gt swarm spawn 5

# Monitor progress
gt convoy show semantic-layer
```

## Formula Structure

```toml
[formula]
name = "formula-name"
description = "What this formula does"
version = "1.0.0"

[[steps]]
id = "step-id"
name = "Human Readable Name"
description = """
Detailed instructions for this step.
Multiple lines allowed.
"""
depends_on = ["previous-step-id"]  # Optional
estimated_minutes = 15              # Optional
```

## Integration with Engram Memory

All formulas integrate with Engram's memory system:

1. **Start**: Call `engram_context(task)` to prime with institutional knowledge
2. **Research**: Use `engram_recall` to check for past decisions/insights
3. **Complete**: Store outcomes with `engram_remember(type='decision'|'insight')`

## Creating Custom Formulas

1. Create a new `.toml` file in `.beads/formulas/`
2. Define `[formula]` metadata
3. Add `[[steps]]` with dependencies
4. Test with `bd cook <formula-name>`
5. Use with `gt mol pour <formula-name> <bead-id>`
