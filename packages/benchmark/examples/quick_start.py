"""
Quick Start Example for Engram Benchmark.

This script demonstrates basic usage:
- Loading a LongMemEval dataset
- Validating the dataset structure
- Inspecting dataset statistics
"""

from pathlib import Path

from engram_benchmark.longmemeval.loader import load_dataset, validate_dataset
from engram_benchmark.longmemeval.types import MemoryAbility


def main() -> None:
    """Run quick start example."""
    # Path to your dataset (adjust as needed)
    dataset_path = Path("data/longmemeval_oracle.json")

    if not dataset_path.exists():
        print(f"Dataset not found: {dataset_path}")
        print("Please download the dataset from:")
        print("https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned")
        return

    print("=" * 60)
    print("Engram Benchmark - Quick Start Example")
    print("=" * 60)

    # Example 1: Validate dataset
    print("\n1. Validating dataset...")
    is_valid, stats = validate_dataset(dataset_path)

    if is_valid:
        print("✓ Dataset is valid!")
        print(f"\nTotal instances: {stats['total']}")
    else:
        print("✗ Dataset validation failed")
        return

    # Example 2: Load dataset
    print("\n2. Loading dataset...")
    dataset = load_dataset(dataset_path)
    print(f"Loaded {len(dataset)} instances")

    # Example 3: Inspect first instance
    print("\n3. Inspecting first instance...")
    first_instance = dataset[0]
    print(f"Question ID: {first_instance.question_id}")
    print(f"Question Type: {first_instance.question_type}")
    print(f"Question: {first_instance.question[:100]}...")
    print(f"Answer: {first_instance.answer}")
    print(f"Number of sessions: {len(first_instance.sessions)}")

    # Example 4: Count instances by memory ability
    print("\n4. Dataset breakdown by memory ability:")
    ability_counts: dict[MemoryAbility, int] = {
        "IE": 0,
        "MR": 0,
        "TR": 0,
        "KU": 0,
        "ABS": 0,
    }

    for instance in dataset:
        # Determine memory ability from question type
        if "single-session" in instance.question_type:
            ability = "IE"
        elif instance.question_type == "multi-session":
            ability = "MR"
        elif instance.question_type == "temporal-reasoning":
            ability = "TR"
        elif instance.question_type == "knowledge-update":
            ability = "KU"
        else:
            ability = "IE"

        # Check for abstention suffix
        if instance.question_id.endswith("_abs"):
            ability = "ABS"

        ability_counts[ability] += 1

    for ability, count in ability_counts.items():
        percentage = (count / len(dataset)) * 100
        print(f"  {ability}: {count:3d} ({percentage:5.1f}%)")

    # Example 5: Sample questions from different abilities
    print("\n5. Sample questions from each ability:")

    sampled_abilities: set[MemoryAbility] = set()
    for instance in dataset:
        # Determine ability
        if "single-session" in instance.question_type:
            ability = "IE"
        elif instance.question_type == "multi-session":
            ability = "MR"
        elif instance.question_type == "temporal-reasoning":
            ability = "TR"
        elif instance.question_type == "knowledge-update":
            ability = "KU"
        else:
            continue

        if instance.question_id.endswith("_abs"):
            ability = "ABS"

        # Print first of each type
        if ability not in sampled_abilities:
            print(f"\n  [{ability}] {instance.question[:80]}...")
            sampled_abilities.add(ability)

        if len(sampled_abilities) >= 5:
            break

    print("\n" + "=" * 60)
    print("Quick start complete!")
    print("\nNext steps:")
    print("  1. Run full benchmark: engram-benchmark run --help")
    print("  2. Check examples/longmemeval_evaluation.py for full pipeline")
    print("  3. Check examples/custom_retriever.py for custom retriever")
    print("=" * 60)


if __name__ == "__main__":
    main()
